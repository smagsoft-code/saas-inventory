import { applyDecorators, CallHandler, ExecutionContext, HttpException, Injectable, Logger, SetMetadata, UseInterceptors, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import { TenantsPlatformRepository } from '../../auth/repositories/tenants-platform.repository';
import { PlatformAuditLogService } from '../audit/platform-audit-log.service';
import { outcomeForStatus } from './support-read-audit.interceptor';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PLATFORM_READ_ACTION = 'platform.read';
const PLATFORM_READ_RESOURCE_KEY = 'auditPlatformReadResource';

/** What a control-plane read looked at — carried in the audit row next to the route template. */
export type PlatformReadResource = 'tenant' | 'tenant_admin_invitation';

/**
 * Opt-in marker for ONE control-plane `GET` handler (ADR-0032 `@PlatformOnly()` routes): wires `PlatformReadAuditInterceptor` to that handler alone.
 * Deliberately per-handler and never global: `GET /platform/support-sessions/current` is read on every SuperAdmin page render (the support banner) and
 * the list / summary reads were left unaudited by decision, so a blanket interceptor on `@PlatformOnly()` would be wrong. GET handlers only — the
 * writes keep their own specific audit rows (`tenant.suspended`, `tenant_admin.invitation_*`, `support_session.*`).
 */
export const AuditPlatformRead = (resource: PlatformReadResource) =>
  applyDecorators(SetMetadata(PLATFORM_READ_RESOURCE_KEY, resource), UseInterceptors(PlatformReadAuditInterceptor));

/**
 * PLATFORM-READS-NOT-AUDITED, option B (FASE 19): `GET /platform/tenants/:tenantId` and `GET /platform/tenants/:tenantId/admin-invitation` write one
 * `audit_log` row `platform.read` — distinct from `support.tenant_read` — through the existing `PlatformAuditLogService`: actor = the authenticated
 * platform admin (`actor_type = 'platform_admin'`, from the verified token, never from client input), `tenant_id` = the tenant of the path,
 * `entity_type = 'tenant'`, `entity_id` = that tenant. `after_state` holds only the method, the route TEMPLATE, the resource, the outcome and HTTP
 * status, and the NAMES of the query parameters — no tokens, cookies, headers, bodies, response data or parameter values.
 *
 * `tenant_id` is attribution, not authorisation: access is still decided by `@PlatformOnly()` and the guards, which run before this interceptor, so a
 * refused request (401 / 403) never reaches it and keeps today's behaviour. The row for a SUCCESSFUL read is written before the response leaves and a
 * failure to write it fails the request (data withheld, one attempt, no cause echoed) — the same fail-closed rule as `SupportReadAuditInterceptor`.
 * The path value is unvalidated when the interceptor starts (pipes run after interceptors) and `audit_log.tenant_id` is a foreign key, so the tenant is
 * attributed only if it EXISTS (a read-only lookup through the existing `TenantsPlatformRepository`); an unknown uuid — e.g. the invitation route
 * answers 200 `null` for one — is recorded with `tenant_id = NULL` and the requested uuid only as `entity_id`, so no HTTP answer changes. A path value that
 * is not a uuid never reaches the handler's service (the pipe answers 400, nothing was read) and is not audited. On error outcomes an audit failure is
 * only logged and the caller gets the real error.
 */
@Injectable()
export class PlatformReadAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PlatformReadAuditInterceptor.name);

  constructor(
    private readonly platformAuditLogService: PlatformAuditLogService,
    private readonly reflector: Reflector,
    private readonly tenantsRepository: TenantsPlatformRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const resource = this.reflector.get<PlatformReadResource | undefined>(PLATFORM_READ_RESOURCE_KEY, context.getHandler());
    if (context.getType() !== 'http' || !resource) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const adminId = request.platformPrincipal?.adminId;
    if (!adminId || request.method !== 'GET') return next.handle();

    const requested = (request.params as Record<string, unknown> | undefined)?.['tenantId'];
    const requestedId = typeof requested === 'string' && UUID_PATTERN.test(requested) ? requested : undefined;
    if (!requestedId) return next.handle(); // not a uuid: the pipe answers 400 and nothing is read

    const record = async (statusCode: number): Promise<void> => {
      const tenant = await this.tenantsRepository.findById(requestedId);
      await this.platformAuditLogService.record({
        tenantId: tenant?.id,
        actorId: adminId,
        actionCode: PLATFORM_READ_ACTION,
        entityType: 'tenant',
        entityId: requestedId,
        afterState: {
          method: request.method,
          route: request.routeOptions?.url ?? 'unknown',
          resource,
          outcome: outcomeForStatus(statusCode),
          statusCode,
          queryKeys: Object.keys((request.query as Record<string, unknown> | undefined) ?? {}),
        },
        correlationId: request.correlationId,
        ipAddress: request.ip,
      });
    };

    return next.handle().pipe(
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        return from(
          record(status).catch((auditError: unknown) => {
            // No data is being returned on this path; never mask the caller's real error with an audit failure.
            this.logger.error(`Failed to write the platform read audit row (${resource}): ${String(auditError)}`);
          }),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
      mergeMap((data: unknown) => from(record(http.getResponse<{ statusCode: number }>().statusCode || 200).then(() => data))),
    );
  }
}
