import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantGuard } from './tenant.guard';

/**
 * 016-C / ADR-0033: TenantGuard now runs ONE live cross-tenant check per request —
 * `TenantMembershipsRepository.findActiveForIdentityAndTenant(identityId, tenantId)` — which
 * returns a row only when the `(identityId, tenantId)` membership is `active` AND `tenants.status`
 * / `identities.status` / `users.status` are all `active` and the user is not soft-deleted. This
 * folds in PROMPT 011-A (tenant status) + 011-B (user status) and extends the same
 * revoke-without-waiting-for-JWT-expiry guarantee to identity + membership status. The full
 * HTTP-level proofs against real PostgreSQL live in test/auth/identity-auth.integration.test.ts
 * and test/administration/{tenant-suspension,user-status}.integration.test.ts.
 */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));
vi.mock('../permissions/load-effective-permissions', () => ({
  loadEffectivePermissions: vi.fn().mockResolvedValue(['products.view']),
}));

function contextFor(
  request: Record<string, unknown>,
  flags: { isPublic?: boolean; isPlatformOnly?: boolean } = {},
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === 'isPublic') return flags.isPublic ?? false;
      if (key === 'isPlatformOnly') return flags.isPlatformOnly ?? false;
      return undefined;
    },
  } as unknown as Reflector;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, reflector };
}

const PRINCIPAL = { userId: 'user-1', identityId: 'identity-1', tenantId: 'tenant-1', tenantSlug: 'acme' };
const ACTIVE_MEMBERSHIP = {
  membershipId: 'm-1',
  identityId: 'identity-1',
  tenantId: 'tenant-1',
  tenantName: 'Acme',
  tenantSlug: 'acme',
  userId: 'user-1',
};

describe('TenantGuard', () => {
  let membershipsRepository: { findActiveForIdentityAndTenant: ReturnType<typeof vi.fn> };
  let supportSessionsRepository: { findActiveForAdmin: ReturnType<typeof vi.fn> };
  let tenantsPlatformRepository: { findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    membershipsRepository = { findActiveForIdentityAndTenant: vi.fn().mockResolvedValue(ACTIVE_MEMBERSHIP) };
    supportSessionsRepository = { findActiveForAdmin: vi.fn().mockResolvedValue(undefined) };
    tenantsPlatformRepository = { findById: vi.fn().mockResolvedValue(undefined) };
  });

  function buildGuard(reflector: Reflector): TenantGuard {
    return new TenantGuard(
      reflector,
      membershipsRepository as never,
      supportSessionsRepository as never,
      tenantsPlatformRepository as never,
    );
  }

  it('allows a @Public() route through without resolving anything', async () => {
    const { context, reflector } = contextFor({}, { isPublic: true });
    await expect(buildGuard(reflector).canActivate(context)).resolves.toBe(true);
    expect(membershipsRepository.findActiveForIdentityAndTenant).not.toHaveBeenCalled();
  });

  it('rejects when the token carries no resolvable tenant/identity', async () => {
    const { context, reflector } = contextFor({ authPrincipal: undefined });
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('No resolvable tenant context.');
    expect(membershipsRepository.findActiveForIdentityAndTenant).not.toHaveBeenCalled();
  });

  it('rejects when the token has a tenantId but no identityId (016-C — pre-migration token)', async () => {
    const { context, reflector } = contextFor({
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    });
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('No resolvable tenant context.');
  });

  it('a @PlatformOnly() route requires platformPrincipal and never looks up a membership', async () => {
    const allowed = contextFor({ platformPrincipal: { adminId: 'admin-1' } }, { isPlatformOnly: true });
    await expect(buildGuard(allowed.reflector).canActivate(allowed.context)).resolves.toBe(true);
    expect(membershipsRepository.findActiveForIdentityAndTenant).not.toHaveBeenCalled();

    const denied = contextFor({}, { isPlatformOnly: true });
    await expect(buildGuard(denied.reflector).canActivate(denied.context)).rejects.toThrow(
      'Platform admin context required.',
    );
  });

  it('allows a tenant-scoped request when the membership (and tenant/identity/user) are all active', async () => {
    const request: Record<string, unknown> = { authPrincipal: PRINCIPAL };
    const { context, reflector } = contextFor(request);
    await expect(buildGuard(reflector).canActivate(context)).resolves.toBe(true);
    expect(membershipsRepository.findActiveForIdentityAndTenant).toHaveBeenCalledWith('identity-1', 'tenant-1');
    expect(request['tenantContext']).toEqual({
      userId: 'user-1',
      identityId: 'identity-1',
      tenantId: 'tenant-1',
      tenantSlug: 'acme',
      permissions: ['products.view'],
    });
  });

  it('rejects when the live check returns nothing (membership / tenant / identity / user not active)', async () => {
    membershipsRepository.findActiveForIdentityAndTenant.mockResolvedValue(undefined);
    const request: Record<string, unknown> = { authPrincipal: PRINCIPAL };
    const { context, reflector } = contextFor(request);
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('Tenant access is not active.');
    expect(request['tenantContext']).toBeUndefined();
  });

  it("rejects when the membership's user_id does not match the token's sub (tampered / stale token)", async () => {
    membershipsRepository.findActiveForIdentityAndTenant.mockResolvedValue({ ...ACTIVE_MEMBERSHIP, userId: 'someone-else' });
    const { context, reflector } = contextFor({ authPrincipal: PRINCIPAL });
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('Tenant access is not active.');
  });

  it('resolves the membership scoped to BOTH identityId and tenantId (never identityId alone)', async () => {
    const { context, reflector } = contextFor({ authPrincipal: PRINCIPAL });
    await buildGuard(reflector).canActivate(context);
    expect(membershipsRepository.findActiveForIdentityAndTenant).toHaveBeenCalledWith('identity-1', 'tenant-1');
  });

  describe('ADR-0036 extension — Platform Admin support-session read access to ordinary tenant routes', () => {
    const ACTIVE_SESSION = {
      id: 'session-1',
      platformAdminId: 'admin-1',
      tenantId: 'tenant-1',
      mode: 'read',
      reason: 'checking a ticket',
      status: 'active',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-01T00:30:00Z'),
    };
    const ACTIVE_TENANT = { id: 'tenant-1', name: 'Acme', slug: 'acme', status: 'active', isDemo: false, createdAt: new Date() };

    it('resolves tenantContext/supportSession from the active session on a GET with no tenant JWT', async () => {
      supportSessionsRepository.findActiveForAdmin.mockResolvedValue(ACTIVE_SESSION);
      tenantsPlatformRepository.findById.mockResolvedValue(ACTIVE_TENANT);
      const request: Record<string, unknown> = { platformPrincipal: { adminId: 'admin-1' }, method: 'GET' };
      const { context, reflector } = contextFor(request);

      await expect(buildGuard(reflector).canActivate(context)).resolves.toBe(true);
      expect(supportSessionsRepository.findActiveForAdmin).toHaveBeenCalledWith('admin-1');
      expect(request['supportSession']).toEqual({
        supportSessionId: 'session-1',
        tenantId: 'tenant-1',
        mode: 'read',
        reason: 'checking a ticket',
        startedAt: ACTIVE_SESSION.startedAt,
        expiresAt: ACTIVE_SESSION.expiresAt,
      });
      expect(request['tenantContext']).toMatchObject({ tenantId: 'tenant-1', tenantSlug: 'acme' });
      // Never a real users/identities row — membership lookup is never reached for this branch.
      expect(membershipsRepository.findActiveForIdentityAndTenant).not.toHaveBeenCalled();
    });

    it('never resolves a support session for a non-GET request — the curated support controller is the only write surface', async () => {
      const request: Record<string, unknown> = { platformPrincipal: { adminId: 'admin-1' }, method: 'POST' };
      const { context, reflector } = contextFor(request);

      await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('No resolvable tenant context.');
      expect(supportSessionsRepository.findActiveForAdmin).not.toHaveBeenCalled();
    });

    it('rejects when the platform admin has no active support session', async () => {
      supportSessionsRepository.findActiveForAdmin.mockResolvedValue(undefined);
      const request: Record<string, unknown> = { platformPrincipal: { adminId: 'admin-1' }, method: 'GET' };
      const { context, reflector } = contextFor(request);

      await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('No resolvable tenant context.');
    });

    it('rejects when the session\'s tenant is not active (suspended mid-session)', async () => {
      supportSessionsRepository.findActiveForAdmin.mockResolvedValue(ACTIVE_SESSION);
      tenantsPlatformRepository.findById.mockResolvedValue({ ...ACTIVE_TENANT, status: 'suspended' });
      const request: Record<string, unknown> = { platformPrincipal: { adminId: 'admin-1' }, method: 'GET' };
      const { context, reflector } = contextFor(request);

      await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('No resolvable tenant context.');
    });
  });
});
