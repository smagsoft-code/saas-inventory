import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { TenantsPlatformRepository } from '../../auth/repositories/tenants-platform.repository';
import { withTenantTransaction } from '../../database/tenant-context';
import { IS_PLATFORM_ONLY_KEY } from '../decorators/platform-only.decorator';
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
 *
 * @PlatformOnly() routes (FASE 11's SuperAdmin endpoints) take a third path, structurally
 * separate from both of the above: they require a verified `platformPrincipal` (set by
 * JwtAuthGuard from a platform-context token) and never touch tenant RBAC at all — no
 * `tenantContext`, no `loadEffectivePermissions` call, no permission catalog lookup. This is what
 * rule 13 of this phase means by "never protect platform operations with the tenant
 * PermissionsGuard" — there is nothing for that guard to check on these requests in the first
 * place, by construction.
 *
 * PROMPT 011-A: tenant scope is resolved from the verified token, but *whether that scope is
 * currently allowed to operate* is not a token claim — it is read fresh from `tenants.status` on
 * every request (never frozen into the JWT, which would leave a suspended tenant operable until
 * the access token's TTL naturally expired). A JWT issued while a tenant was `active` must stop
 * working the moment that tenant is suspended, not merely from its next login/refresh — this is
 * the single central enforcement point for that, so no controller anywhere re-checks
 * `tenants.status` on its own.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const isPlatformOnly = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPlatformOnly) {
      if (!request.platformPrincipal) {
        throw new ForbiddenException('Platform admin context required.');
      }
      return true;
    }

    const principal = request.authPrincipal;
    if (!principal?.tenantId) {
      throw new ForbiddenException('No resolvable tenant context.');
    }

    // Server-side, live status check (never a JWT claim) — the fix for PROMPT 011-A's core
    // scenario: a token minted while the tenant was 'active' must be rejected here as soon as
    // tenants.status stops being 'active' (suspended/archived), well before the token's own TTL
    // expiry. Checked via the app_platform (BYPASSRLS) connection, before the tenant-scoped
    // transaction below, deliberately kept separate from RLS — status gates *whether* a tenant
    // may operate at all, RLS gates *isolation between* tenants; conflating the two would mean
    // adding a status condition to every tenant-owned table's policy instead of one central check.
    const tenant = await this.tenantsPlatformRepository.findById(principal.tenantId);
    if (!tenant || tenant.status !== 'active') {
      throw new ForbiddenException('Tenant is not active.');
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
