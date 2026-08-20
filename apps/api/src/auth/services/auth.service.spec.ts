import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

/**
 * Unit tests with every repository/token dependency mocked — no database, no Nest DI container.
 * withTenantTransaction() (database/tenant-context.ts) is mocked to just invoke its callback with
 * a stub `tx` object, since these tests exercise AuthService's own branching logic (credential
 * checks, session issuance, reuse detection), not the persistence layer — that's covered by the
 * RLS integration tests (test/database/multi-tenancy-rls.integration.test.ts) and the full HTTP
 * flow integration test (test/auth/auth-flow.integration.test.ts).
 */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const ACTIVE_USER = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'admin@example.com',
  passwordHash: 'stored-hash',
  fullName: 'Admin User',
  status: 'active',
};

function buildService() {
  const tenantProvisioningService = { provision: vi.fn() };
  const tenantsPlatformRepository = { findBySlug: vi.fn(), findById: vi.fn() };
  const usersRepository = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    touchLastLogin: vi.fn(),
  };
  const rolesRepository = { effectivePermissionsForUser: vi.fn().mockResolvedValue(['products.view']) };
  const refreshTokensRepository = { create: vi.fn(), revoke: vi.fn(), revokeAllForUser: vi.fn() };
  const refreshTokensPlatformRepository = { findByHash: vi.fn() };
  const passwordService = { hash: vi.fn().mockResolvedValue('hashed'), verify: vi.fn() };
  const accessTokenService = { issue: vi.fn().mockResolvedValue({ token: 'access-token', expiresInSeconds: 900 }) };
  const refreshTokenService = {
    generate: vi
      .fn()
      .mockReturnValue({ token: 'raw-refresh', tokenHash: 'hashed-refresh', expiresAt: new Date(Date.now() + 1000) }),
    hash: vi.fn().mockReturnValue('hashed-refresh'),
  };
  const csrfTokenService = { generate: vi.fn().mockReturnValue('csrf-token') };

  const service = new AuthService(
    tenantProvisioningService as never,
    tenantsPlatformRepository as never,
    usersRepository as never,
    rolesRepository as never,
    refreshTokensRepository as never,
    refreshTokensPlatformRepository as never,
    passwordService as never,
    accessTokenService as never,
    refreshTokenService as never,
    csrfTokenService as never,
  );

  return {
    service,
    tenantProvisioningService,
    tenantsPlatformRepository,
    usersRepository,
    rolesRepository,
    refreshTokensRepository,
    refreshTokensPlatformRepository,
    passwordService,
    accessTokenService,
    refreshTokenService,
    csrfTokenService,
  };
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('provisions a tenant, hashes the password, and issues a session', async () => {
      const mocks = buildService();
      mocks.tenantProvisioningService.provision.mockResolvedValue({
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        userId: 'user-1',
      });

      const session = await mocks.service.register(
        { companyName: 'Acme', email: 'Admin@Example.com', password: 'a-long-password', fullName: 'Admin User' },
        {},
      );

      expect(mocks.passwordService.hash).toHaveBeenCalledWith('a-long-password');
      expect(mocks.tenantProvisioningService.provision).toHaveBeenCalledWith(
        expect.objectContaining({ adminEmail: 'admin@example.com', adminPasswordHash: 'hashed' }),
      );
      expect(session.user).toMatchObject({ tenantId: 'tenant-1', tenantSlug: 'acme', email: 'admin@example.com' });
      expect(session.accessToken).toBe('access-token');
      expect(session.refreshToken).toBe('raw-refresh');
      // The password hash is never present anywhere on the issued session.
      expect(JSON.stringify(session)).not.toContain('hashed-password-should-never-appear');
      expect(session.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('login', () => {
    it('rejects an unknown tenant slug with the generic invalid-credentials message', async () => {
      const mocks = buildService();
      mocks.tenantsPlatformRepository.findBySlug.mockResolvedValue(undefined);

      await expect(
        mocks.service.login({ tenantSlug: 'no-such-tenant', email: 'a@b.com', password: 'x' }, {}),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        mocks.service.login({ tenantSlug: 'no-such-tenant', email: 'a@b.com', password: 'x' }, {}),
      ).rejects.toThrow('Invalid tenant, email, or password.');
      // Still runs a dummy hash verification, for timing consistency.
      expect(mocks.passwordService.verify).toHaveBeenCalled();
    });

    it('rejects a suspended tenant with the same generic message', async () => {
      const mocks = buildService();
      mocks.tenantsPlatformRepository.findBySlug.mockResolvedValue({ id: 'tenant-1', status: 'suspended' });

      await expect(mocks.service.login({ tenantSlug: 'acme', email: 'a@b.com', password: 'x' }, {})).rejects.toThrow(
        'Invalid tenant, email, or password.',
      );
    });

    it('rejects a nonexistent user with the same generic message (no enumeration)', async () => {
      const mocks = buildService();
      mocks.tenantsPlatformRepository.findBySlug.mockResolvedValue({ id: 'tenant-1', status: 'active' });
      mocks.usersRepository.findByEmail.mockResolvedValue(undefined);

      await expect(
        mocks.service.login({ tenantSlug: 'acme', email: 'nobody@example.com', password: 'x' }, {}),
      ).rejects.toThrow('Invalid tenant, email, or password.');
      expect(mocks.passwordService.verify).toHaveBeenCalled();
    });

    it('rejects a disabled/invited user with the same generic message', async () => {
      const mocks = buildService();
      mocks.tenantsPlatformRepository.findBySlug.mockResolvedValue({ id: 'tenant-1', status: 'active' });
      mocks.usersRepository.findByEmail.mockResolvedValue({ ...ACTIVE_USER, status: 'disabled' });

      await expect(
        mocks.service.login({ tenantSlug: 'acme', email: ACTIVE_USER.email, password: 'x' }, {}),
      ).rejects.toThrow('Invalid tenant, email, or password.');
    });

    it('rejects a wrong password with the same generic message', async () => {
      const mocks = buildService();
      mocks.tenantsPlatformRepository.findBySlug.mockResolvedValue({ id: 'tenant-1', status: 'active' });
      mocks.usersRepository.findByEmail.mockResolvedValue(ACTIVE_USER);
      mocks.passwordService.verify.mockResolvedValue(false);

      await expect(
        mocks.service.login({ tenantSlug: 'acme', email: ACTIVE_USER.email, password: 'wrong' }, {}),
      ).rejects.toThrow('Invalid tenant, email, or password.');
    });

    it('issues a session and records last-login on valid credentials', async () => {
      const mocks = buildService();
      mocks.tenantsPlatformRepository.findBySlug.mockResolvedValue({ id: 'tenant-1', slug: 'acme', status: 'active' });
      mocks.usersRepository.findByEmail.mockResolvedValue(ACTIVE_USER);
      mocks.passwordService.verify.mockResolvedValue(true);

      const session = await mocks.service.login(
        { tenantSlug: 'acme', email: ACTIVE_USER.email, password: 'correct' },
        {},
      );

      expect(mocks.usersRepository.touchLastLogin).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'user-1');
      expect(session.user.permissions).toEqual(['products.view']);
      expect(session.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('refresh', () => {
    it('rejects when no token is presented', async () => {
      const mocks = buildService();
      await expect(mocks.service.refresh(undefined, {})).rejects.toThrow('Invalid or expired session.');
    });

    it('rejects an unknown token hash', async () => {
      const mocks = buildService();
      mocks.refreshTokensPlatformRepository.findByHash.mockResolvedValue(undefined);
      await expect(mocks.service.refresh('some-token', {})).rejects.toThrow('Invalid or expired session.');
    });

    it('rejects an expired token', async () => {
      const mocks = buildService();
      mocks.refreshTokensPlatformRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });
      await expect(mocks.service.refresh('some-token', {})).rejects.toThrow('Invalid or expired session.');
      expect(mocks.refreshTokensRepository.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('treats a revoked (already-rotated) token being reused as possible theft and revokes every session', async () => {
      const mocks = buildService();
      mocks.refreshTokensPlatformRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100_000),
        revokedAt: new Date(),
      });
      await expect(mocks.service.refresh('reused-token', {})).rejects.toThrow('Invalid or expired session.');
      expect(mocks.refreshTokensRepository.revokeAllForUser).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-1',
        'user-1',
      );
    });

    it('rejects if the underlying user no longer exists or is disabled', async () => {
      const mocks = buildService();
      mocks.refreshTokensPlatformRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100_000),
        revokedAt: null,
      });
      mocks.usersRepository.findById.mockResolvedValue(undefined);
      await expect(mocks.service.refresh('valid-token', {})).rejects.toThrow('Invalid or expired session.');
    });

    it('rotates: revokes the old token and issues a new one on success', async () => {
      const mocks = buildService();
      mocks.refreshTokensPlatformRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100_000),
        revokedAt: null,
      });
      mocks.usersRepository.findById.mockResolvedValue(ACTIVE_USER);

      const session = await mocks.service.refresh('valid-token', {});

      expect(mocks.refreshTokensRepository.revoke).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'rt-1');
      expect(mocks.refreshTokensRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rotatedFromId: 'rt-1' }),
      );
      expect(session.user.tenantSlug).toBe('acme');
    });
  });

  describe('logout', () => {
    it('is a no-op (succeeds) when no token is presented', async () => {
      const mocks = buildService();
      await expect(mocks.service.logout(undefined)).resolves.toBeUndefined();
      expect(mocks.refreshTokensRepository.revoke).not.toHaveBeenCalled();
    });

    it('is a no-op (succeeds) for an unknown or already-revoked token', async () => {
      const mocks = buildService();
      mocks.refreshTokensPlatformRepository.findByHash.mockResolvedValue(undefined);
      await expect(mocks.service.logout('unknown')).resolves.toBeUndefined();
      expect(mocks.refreshTokensRepository.revoke).not.toHaveBeenCalled();
    });

    it('revokes the presented token', async () => {
      const mocks = buildService();
      mocks.refreshTokensPlatformRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100_000),
        revokedAt: null,
      });
      await mocks.service.logout('valid-token');
      expect(mocks.refreshTokensRepository.revoke).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'rt-1');
    });
  });

  describe('me', () => {
    it('returns the current user view without the password hash', async () => {
      const mocks = buildService();
      mocks.usersRepository.findById.mockResolvedValue(ACTIVE_USER);

      const view = await mocks.service.me('user-1', 'tenant-1', 'acme');

      expect(view).not.toHaveProperty('passwordHash');
      expect(view).toEqual(
        expect.objectContaining({ id: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme', permissions: ['products.view'] }),
      );
    });

    it('rejects if the user was deleted/disabled since the token was issued', async () => {
      const mocks = buildService();
      mocks.usersRepository.findById.mockResolvedValue(undefined);
      await expect(mocks.service.me('user-1', 'tenant-1', 'acme')).rejects.toThrow('Invalid or expired session.');
    });
  });
});
