import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { withTenantTransaction } from '../../database/tenant-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { loadEffectivePermissions } from '../permissions/load-effective-permissions';

/**
 * "What tenant, and what can you do?" — api.md#request-flow's Tenant Guard. Resolves tenant scope
 * exclusively from the already-verified token claims (never client input — multi-tenancy.md), and
 * loads the caller's effective permissions (ADR-0009) for PermissionsGuard to check afterward.
 * Runs after JwtAuthGuard in the global guard chain (common.module.ts) — a route without a
 * resolvable tenant is rejected with 403, except @Public() routes.
 *
 * Every tenant user in this schema belongs to exactly one tenant (users.tenant_id is NOT NULL,
 * database.md) — there is no "active tenant" to select or switch, so resolution here is a direct
 * read of the token's tenantId claim, not a lookup across memberships.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.authPrincipal;
    if (!principal?.tenantId) {
      throw new ForbiddenException('No resolvable tenant context.');
    }

    const permissions = await withTenantTransaction(principal.tenantId, (tx) =>
      loadEffectivePermissions(tx, principal.userId),
    );

    request.tenantContext = {
      userId: principal.userId,
      tenantId: principal.tenantId,
      tenantSlug: principal.tenantSlug,
      permissions,
    };
    return true;
  }
}
