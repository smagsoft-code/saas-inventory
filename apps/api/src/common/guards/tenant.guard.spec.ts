import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantGuard } from './tenant.guard';

/**
 * PROMPT 011-A/011-B: TenantGuard is the single central enforcement point for "is this tenant
 * currently allowed to operate" (tenants.status) and "is this user currently allowed to operate"
 * (users.status), both read fresh on every request rather than trusted from the JWT — see this
 * file's own header comment. The full HTTP-level proof (a real access token issued before
 * suspension/deactivation, against a real route, against real PostgreSQL) lives in
 * test/administration/tenant-suspension.integration.test.ts and
 * test/administration/user-status.integration.test.ts.
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

const ACTIVE_TENANT = { id: 'tenant-1', status: 'active' };
const ACTIVE_USER_ROW = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'user@example.com',
  passwordHash: 'x',
  fullName: 'User',
  status: 'active',
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('TenantGuard', () => {
  let tenantsPlatformRepository: { findById: ReturnType<typeof vi.fn> };
  let usersRepository: { findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tenantsPlatformRepository = { findById: vi.fn().mockResolvedValue(ACTIVE_TENANT) };
    usersRepository = { findById: vi.fn().mockResolvedValue(ACTIVE_USER_ROW) };
  });

  function buildGuard(reflector: Reflector): TenantGuard {
    return new TenantGuard(reflector, tenantsPlatformRepository as never, usersRepository as never);
  }

  it('allows a @Public() route through without resolving a tenant or user at all', async () => {
    const { context, reflector } = contextFor({}, { isPublic: true });
    const guard = buildGuard(reflector);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tenantsPlatformRepository.findById).not.toHaveBeenCalled();
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('rejects when no tenant can be resolved from the token at all (existing behavior)', async () => {
    const { context, reflector } = contextFor({ authPrincipal: undefined });
    const guard = buildGuard(reflector);
    await expect(guard.canActivate(context)).rejects.toThrow('No resolvable tenant context.');
    expect(tenantsPlatformRepository.findById).not.toHaveBeenCalled();
  });

  it('a @PlatformOnly() route requires platformPrincipal and never looks up a tenant or user (existing behavior, unaffected)', async () => {
    const allowed = contextFor({ platformPrincipal: { adminId: 'admin-1' } }, { isPlatformOnly: true });
    await expect(buildGuard(allowed.reflector).canActivate(allowed.context)).resolves.toBe(true);
    expect(tenantsPlatformRepository.findById).not.toHaveBeenCalled();
    expect(usersRepository.findById).not.toHaveBeenCalled();

    const denied = contextFor({}, { isPlatformOnly: true });
    await expect(buildGuard(denied.reflector).canActivate(denied.context)).rejects.toThrow(
      'Platform admin context required.',
    );
  });

  it('allows a tenant-scoped request when both the tenant and the user are active', async () => {
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    const guard = buildGuard(reflector);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(usersRepository.findById).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'user-1');
    expect(request['tenantContext']).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      tenantSlug: 'acme',
      permissions: ['products.view'],
    });
  });

  it('PROMPT 011-A: rejects a tenant-scoped request when tenants.status is suspended, even with an otherwise-valid token', async () => {
    tenantsPlatformRepository.findById.mockResolvedValue({ id: 'tenant-1', status: 'suspended' });
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    const guard = buildGuard(reflector);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('Tenant is not active.');
    expect(request['tenantContext']).toBeUndefined();
    // Suspension is caught before ever touching the users table — cheaper failure path.
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('PROMPT 011-A: rejects when the resolved tenant is archived', async () => {
    tenantsPlatformRepository.findById.mockResolvedValue({ id: 'tenant-1', status: 'archived' });
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('Tenant is not active.');
  });

  it('PROMPT 011-A: rejects when the tenant id from the token no longer resolves to any row', async () => {
    tenantsPlatformRepository.findById.mockResolvedValue(undefined);
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('Tenant is not active.');
  });

  it('PROMPT 011-B: rejects a tenant-scoped request when users.status is disabled, even with an otherwise-valid token', async () => {
    usersRepository.findById.mockResolvedValue({ ...ACTIVE_USER_ROW, status: 'disabled' });
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    const guard = buildGuard(reflector);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('User is not active.');
    expect(request['tenantContext']).toBeUndefined();
  });

  it('PROMPT 011-B: rejects when users.status is invited (not yet activated)', async () => {
    usersRepository.findById.mockResolvedValue({ ...ACTIVE_USER_ROW, status: 'invited' });
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('User is not active.');
  });

  it('PROMPT 011-B: rejects when the user id from the token no longer resolves to any row (deleted, or belongs to a different tenant)', async () => {
    usersRepository.findById.mockResolvedValue(undefined);
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow('User is not active.');
  });

  it('PROMPT 011-B: resolves the user scoped to both tenantId and userId from the token (never trusts userId alone)', async () => {
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    await buildGuard(reflector).canActivate(context);
    expect(usersRepository.findById).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'user-1');
  });
});
