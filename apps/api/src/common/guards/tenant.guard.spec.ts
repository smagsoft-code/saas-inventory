import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantGuard } from './tenant.guard';

/**
 * PROMPT 011-A: TenantGuard is the single central enforcement point for "is this tenant currently
 * allowed to operate" (tenants.status), read fresh on every request rather than trusted from the
 * JWT — see this file's own header comment. These tests cover exactly the four cases rule 47 of
 * that prompt asks for; the full HTTP-level proof (a real access token issued before suspension,
 * against a real route, against real PostgreSQL) lives in
 * test/administration/tenant-suspension.integration.test.ts.
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

describe('TenantGuard', () => {
  let tenantsPlatformRepository: { findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tenantsPlatformRepository = { findById: vi.fn() };
  });

  it('allows a @Public() route through without resolving a tenant at all', async () => {
    const { context, reflector } = contextFor({}, { isPublic: true });
    const guard = new TenantGuard(reflector, tenantsPlatformRepository as never);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tenantsPlatformRepository.findById).not.toHaveBeenCalled();
  });

  it('rejects when no tenant can be resolved from the token at all (existing behavior)', async () => {
    const { context, reflector } = contextFor({ authPrincipal: undefined });
    const guard = new TenantGuard(reflector, tenantsPlatformRepository as never);
    await expect(guard.canActivate(context)).rejects.toThrow('No resolvable tenant context.');
    expect(tenantsPlatformRepository.findById).not.toHaveBeenCalled();
  });

  it('a @PlatformOnly() route requires platformPrincipal and never looks up a tenant (existing behavior, unaffected)', async () => {
    const allowed = contextFor({ platformPrincipal: { adminId: 'admin-1' } }, { isPlatformOnly: true });
    const guardAllowed = new TenantGuard(allowed.reflector, tenantsPlatformRepository as never);
    await expect(guardAllowed.canActivate(allowed.context)).resolves.toBe(true);
    expect(tenantsPlatformRepository.findById).not.toHaveBeenCalled();

    const denied = contextFor({}, { isPlatformOnly: true });
    const guardDenied = new TenantGuard(denied.reflector, tenantsPlatformRepository as never);
    await expect(guardDenied.canActivate(denied.context)).rejects.toThrow('Platform admin context required.');
  });

  it('allows a tenant-scoped request when the resolved tenant is active', async () => {
    tenantsPlatformRepository.findById.mockResolvedValue({ id: 'tenant-1', status: 'active' });
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    const guard = new TenantGuard(reflector, tenantsPlatformRepository as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
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
    const guard = new TenantGuard(reflector, tenantsPlatformRepository as never);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('Tenant is not active.');
    expect(request['tenantContext']).toBeUndefined();
  });

  it('PROMPT 011-A: rejects when the resolved tenant is archived', async () => {
    tenantsPlatformRepository.findById.mockResolvedValue({ id: 'tenant-1', status: 'archived' });
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    const guard = new TenantGuard(reflector, tenantsPlatformRepository as never);

    await expect(guard.canActivate(context)).rejects.toThrow('Tenant is not active.');
  });

  it('PROMPT 011-A: rejects when the tenant id from the token no longer resolves to any row', async () => {
    tenantsPlatformRepository.findById.mockResolvedValue(undefined);
    const request: Record<string, unknown> = {
      authPrincipal: { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' },
    };
    const { context, reflector } = contextFor(request);
    const guard = new TenantGuard(reflector, tenantsPlatformRepository as never);

    await expect(guard.canActivate(context)).rejects.toThrow('Tenant is not active.');
  });
});
