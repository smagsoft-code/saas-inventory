import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { TenantMembershipsRepository } from '../../auth/repositories/tenant-memberships.repository';
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
 * 016-C / ADR-0033: the token now carries both `sub` (users.id, unchanged) and `identityId`
 * (identities.id). Tenant scope is still resolved *only* from the verified token's `tenantId`
 * claim — never client input. What changed is the live-status check below: one JOINed
 * `app_platform` read (`TenantMembershipsRepository.findActiveForIdentityAndTenant`) now confirms,
 * in a single round trip, that the `(identityId, tenantId)` membership exists and is `active`,
 * that `tenants.status`, `identities.status` and `users.status` are all `active` and the user is
 * not soft-deleted, AND that the membership's `user_id` matches the token's `sub` (structurally
 * ruling out a tampered/stale token). This folds PROMPT 011-A (tenant status) and 011-B (user
 * status) into the same query and extends the identical "revoke without waiting for JWT expiry"
 * property to identity and membership status. One tenant transaction then loads effective
 * permissions (ADR-0009). A session's JWT is always scoped to exactly one tenant; changing tenant
 * requires a fresh login/selection (switch-tenant is a later prompt).
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
 *
 * PROMPT 011-B: the identical live-read principle applies to the *user*, not only the tenant.
 * `login()`/`refresh()`/`me()` (auth.service.ts) already re-fetch the user and check
 * `user.status === 'active'` on every one of those calls — but nothing previously did the same
 * for an already-issued access token's ordinary tenant-scoped requests: `loadEffectivePermissions`
 * only ever reads `user_roles`/`role_permissions`, never `users`, so a disabled user's still-valid
 * token kept working until it naturally expired. Fixed here, in the same transaction that already
 * loads permissions, via `UsersRepository.findById` (tenant- *and* user-id-scoped — this is also
 * what structurally guarantees `user.tenant_id == tenant.id`, per §15: a user row from a different
 * tenant can never match this WHERE clause, so nothing further is needed to rule that out) —
 * indexed on the same `(tenant_id, id)` primary key every other tenant-scoped lookup in this
 * codebase already uses, not a new query shape.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantMembershipsRepository: TenantMembershipsRepository,
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
    if (!principal?.tenantId || !principal.identityId) {
      throw new ForbiddenException('No resolvable tenant context.');
    }

    // One live cross-tenant read via app_platform (BYPASSRLS): the `(identityId, tenantId)`
    // membership must exist and be `active`, and `tenants.status` / `identities.status` /
    // `users.status` must all be `active` with the user not soft-deleted. This gates *whether*
    // this identity may still operate in this tenant at all — deliberately separate from RLS,
    // which gates *isolation between* tenants. Folds PROMPT 011-A (tenant status) + 011-B (user
    // status) into one query and extends the same immediate-revocation property to identity and
    // membership status (ADR-0033). `context.userId !== principal.userId` catches a token whose
    // `sub` no longer matches its identity's membership for this tenant (tampering / staleness).
    const membership = await this.tenantMembershipsRepository.findActiveForIdentityAndTenant(
      principal.identityId,
      principal.tenantId,
    );
    if (!membership || membership.userId !== principal.userId) {
      throw new ForbiddenException('Tenant access is not active.');
    }

    const permissions = await withTenantTransaction(principal.tenantId, (tx) =>
      loadEffectivePermissions(tx, principal.userId),
    );

    request.tenantContext = {
      userId: principal.userId,
      identityId: principal.identityId,
      tenantId: principal.tenantId,
      tenantSlug: principal.tenantSlug,
      permissions,
    };
    return true;
  }
}
