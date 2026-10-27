import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import { PlatformAuditLogService } from '../audit/platform-audit-log.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SUPPORT_READ_ACTION = 'support.tenant_read';

export type SupportReadOutcome = 'success' | 'not_found' | 'denied' | 'rejected' | 'error';

export function outcomeForStatus(status: number): SupportReadOutcome {
  if (status >= 500) return 'error';
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'denied';
  if (status >= 400) return 'rejected';
  return 'success';
}

/**
 * SUP-READ-NOT-AUDITED (FASE 19) — every `GET` served under an active support session (ADR-0036: the general tenant-API read-through
 * resolved by `TenantGuard`, and the curated `support/*` reads resolved by `SupportSessionGuard`) leaves one `audit_log` row
 * `support.tenant_read`: actor = the PLATFORM admin, tenant = the session's tenant, entity = the support session. Until now only the
 * session's start/end and the curated write were audited, so the tenant could not learn WHAT support read.
 *
 * What is recorded — and nothing else: the method, the route TEMPLATE (`/api/v1/orders/:id`, the resource category), the outcome and
 * HTTP status, the session mode, the NAMES of the query parameters (never their values — a search term can be a customer name) and,
 * when the route carries one, the uuid of the addressed resource. Never tokens, cookies, headers, bodies or response payloads.
 *
 * Reliability: on success the row is written BEFORE the response leaves, and a failure to write it fails the request (the data is
 * withheld) — a read that cannot be accounted for is not served. On an error outcome no data is being returned, so a failed audit write
 * is only logged and the original error is what the caller gets. Requests that never reach the handler (no session, an expired
 * session, a suspended tenant, a refused verb) are refused by the guards, touch no tenant data and are not read rows.
 *
 * Only `GET`s: the curated write keeps its own specific audit row (`support.warehouse_status_changed`) and non-GET verbs are refused
 * outright under a support session, so there is no duplicate. Requests without `supportSession` (every ordinary tenant request, every
 * other platform route) are passed through untouched.
 */
@Injectable()
export class SupportReadAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SupportReadAuditInterceptor.name);

  constructor(private readonly platformAuditLogService: PlatformAuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const session = request.supportSession;
    const adminId = request.platformPrincipal?.adminId;
    if (!session || !adminId || request.method !== 'GET') return next.handle();

    const record = (statusCode: number): Promise<void> =>
      this.platformAuditLogService.record({
        tenantId: session.tenantId,
        actorId: adminId,
        actionCode: SUPPORT_READ_ACTION,
        entityType: 'support_session',
        entityId: session.supportSessionId,
        afterState: {
          method: request.method,
          route: request.routeOptions?.url ?? 'unknown',
          outcome: outcomeForStatus(statusCode),
          statusCode,
          mode: session.mode,
          queryKeys: Object.keys((request.query as Record<string, unknown> | undefined) ?? {}),
          ...this.resourceId(request),
        },
        correlationId: request.correlationId,
        ipAddress: request.ip,
      });

    // Order matters: the error handler comes BEFORE the success audit, so a failure to write the success row is not caught here and
    // retried as an "error" row — it simply fails the request (data withheld), with exactly one write attempt.
    return next.handle().pipe(
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        return from(
          record(status).catch((auditError: unknown) => {
            // No data is being returned on this path; never mask the caller's real error with an audit failure.
            this.logger.error(`Failed to write the support read audit row (${session.supportSessionId}): ${String(auditError)}`);
          }),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
      mergeMap((data: unknown) => from(record(http.getResponse<{ statusCode: number }>().statusCode || 200).then(() => data))),
    );
  }

  /** The uuid of the addressed resource, if the route has one (`:id`, `:warehouseId`, …) — the session's own `:tenantId` is not a resource. */
  private resourceId(request: FastifyRequest): { resourceId?: string } {
    const params = (request.params as Record<string, unknown> | undefined) ?? {};
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'tenantId' && typeof value === 'string' && UUID_PATTERN.test(value)) return { resourceId: value };
    }
    return {};
  }
}
