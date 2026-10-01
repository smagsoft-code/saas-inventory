import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PlatformSupportSessionsRepository, type SupportSessionMode } from '../../auth/repositories/platform-support-sessions.repository';
import { SUPPORT_SESSION_MODE_KEY } from '../decorators/require-support-session.decorator';

/**
 * ADR-0036 — the second, additional gate every `@RequireSupportSession()` route needs beyond
 * `@PlatformOnly()`. Runs after `TenantGuard` in the chain (registered per-route via
 * `@UseGuards()`, not globally — only the small, curated set of support-scoped controllers uses
 * it) and answers "does this platform admin currently have a live, unexpired support session on
 * this exact `:tenantId`, in at least the required mode."
 *
 * Deliberately reads a live DB row on every call (`findActiveForAdminAndTenant`), never a JWT
 * claim or anything cached — a session ended or expired must stop working on its very next
 * request, the same "live-check, not frozen-into-a-token" principle `TenantGuard` already applies
 * to tenant/user/identity/membership status (PROMPT 011-A/011-B, ADR-0033). The `:tenantId` route
 * param is trusted only as the *lookup key* into that row, never as authorization by itself — a
 * platform admin with a live session on tenant A cannot satisfy this guard for tenant B by simply
 * changing the URL, because no row exists for that pair.
 */
@Injectable()
export class SupportSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supportSessionsRepository: PlatformSupportSessionsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredMode = this.reflector.getAllAndOverride<SupportSessionMode | undefined>(SUPPORT_SESSION_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredMode) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.platformPrincipal) {
      throw new ForbiddenException('Platform admin context required.');
    }
    const tenantId = (request.params as Record<string, string | undefined>)?.['tenantId'];
    if (!tenantId) {
      // Programmer error (a route decorated with @RequireSupportSession must carry :tenantId) —
      // never a client-facing condition, so this is not the generic "no session" 403 below.
      throw new ForbiddenException('Route is missing :tenantId.');
    }

    const session = await this.supportSessionsRepository.findActiveForAdminAndTenant(request.platformPrincipal.adminId, tenantId);
    if (!session) {
      throw new ForbiddenException('No active support session for this tenant. Start one from the tenant detail page.');
    }
    if (requiredMode === 'write' && session.mode !== 'write') {
      throw new ForbiddenException('This operation requires an intervention (SUPPORT_WRITE) session, not a read-only one.');
    }

    request.supportSession = {
      supportSessionId: session.id,
      tenantId: session.tenantId,
      mode: session.mode as 'read' | 'write',
      reason: session.reason,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
    };
    return true;
  }
}
