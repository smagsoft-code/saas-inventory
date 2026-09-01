import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

/**
 * Unit tests with every repository/token dependency mocked — no database, no Nest DI container.
 * `withTenantTransaction()` is mocked to just invoke its callback with a stub `tx`. These exercise
 * AuthService's own branching (016-C: identity credential check, one-vs-many memberships, tenant
 * selection, refresh rotation) — the full HTTP flow against real PostgreSQL is
 * test/auth/identity-auth.integration.test.ts and test/auth/auth-flow.integration.test.ts.
 */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const ACTIVE_IDENTITY = {
  id: 'identity-1',
  email: 'person@example.com',
  passwordHash: 'stored-identity-hash',
  status: 'active',
  fullName: 'Person',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const MEMBERSHIP_A = {
  membershipId: 'm-a',
  identityId: 'identity-1',
  tenantId: 'tenant-a',
  tenantName: 'Muebles',
  tenantSlug: 'muebles',
  userId: 'user-a',
};
const MEMBERSHIP_B = {
  membershipId: 'm-b',
  identityId: 'identity-1',
  tenantId: 'tenant-b',
  tenantName: 'Electro',
  tenantSlug: 'electro',
  userId: 'user-b',
};

const ACTIVE_USER_A = {
  id: 'user-a',
  tenantId: 'tenant-a',
  email: 'person@example.com',
  passwordHash: 'ignored-users-hash',
  fullName: 'Person A',
  status: 'active',
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const tenantProvisioningService = { provision: vi.fn() };
  const identityProvisioningService = { provisionMembership: vi.fn().mockResolvedValue({ identityId: 'identity-1' }) };
  const identitiesRepository = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    findOrCreate: vi.fn(),
    touchLastLogin: vi.fn(),
  };
  const tenantMembershipsRepository = {
    listActiveForIdentity: vi.fn(),
    findActiveForIdentityAndTenant: vi.fn(),
    findActiveForTenantAndUser: vi.fn(),
    create: vi.fn(),
  };
  const usersRepository = { findById: vi.fn().mockResolvedValue(ACTIVE_USER_A), touchLastLogin: vi.fn() };
  const rolesRepository = { effectivePermissionsForUser: vi.fn().mockResolvedValue(['products.view']) };
  const refreshTokensRepository = { create: vi.fn(), revoke: vi.fn(), revokeAllForUser: vi.fn() };
  const refreshTokensPlatformRepository = { findByHash: vi.fn() };
  const passwordService = { hash: vi.fn().mockResolvedValue('hashed'), verify: vi.fn() };
  const accessTokenService = {
    issue: vi.fn().mockResolvedValue({ token: 'access-token', expiresInSeconds: 900 }),
    issueSelection: vi.fn().mockResolvedValue({ token: 'selection-token', expiresInSeconds: 300 }),
  };
  const refreshTokenService = {
    generate: vi
      .fn()
      .mockReturnValue({ token: 'raw-refresh', tokenHash: 'hashed-refresh', expiresAt: new Date(Date.now() + 1000) }),
    hash: vi.fn().mockReturnValue('hashed-refresh'),
  };
  const csrfTokenService = { generate: vi.fn().mockReturnValue('csrf-token') };
  const jwtService = { verifyAsync: vi.fn() };
  const authConfig = { jwtSecret: 'test-secret' };

  const service = new AuthService(
    tenantProvisioningService as never,
    identityProvisioningService as never,
    identitiesRepository as never,
    tenantMembershipsRepository as never,
    usersRepository as never,
    rolesRepository as never,
    refreshTokensRepository as never,
    refreshTokensPlatformRepository as never,
    passwordService as never,
    accessTokenService as never,
    refreshTokenService as never,
    csrfTokenService as never,
    jwtService as never,
    authConfig as never,
  );

  return {
    service,
    tenantProvisioningService,
    identityProvisioningService,
    identitiesRepository,
    tenantMembershipsRepository,
    usersRepository,
    rolesRepository,
    refreshTokensRepository,
    refreshTokensPlatformRepository,
    passwordService,
    accessTokenService,
    refreshTokenService,
    csrfTokenService,
    jwtService,
  };
}

describe('AuthService (016-C)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('register', () => {
    it('provisions tenant + identity + membership and issues a session', async () => {
      const m = buildService();
      m.tenantProvisioningService.provision.mockResolvedValue({ tenantId: 'tenant-a', tenantSlug: 'muebles', userId: 'user-a' });

      const session = await m.service.register(
        { companyName: 'Muebles', email: 'Person@Example.com', password: 'a-long-password', fullName: 'Person' },
        {},
      );

      expect(m.passwordService.hash).toHaveBeenCalledWith('a-long-password');
      expect(m.identityProvisioningService.provisionMembership).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a', email: 'person@example.com' }),
      );
      expect(session.kind).toBe('session');
      expect(session.accessToken).toBe('access-token');
      expect(session.user).toMatchObject({ tenantId: 'tenant-a', tenantSlug: 'muebles', identityId: 'identity-1' });
      expect(session.user).not.toHaveProperty('passwordHash');
      expect(m.accessTokenService.issue).toHaveBeenCalledWith('user-a', 'identity-1', 'tenant-a', 'muebles');
    });
  });

  describe('login', () => {
    it('rejects an unknown email with the generic message (+ dummy hash for timing)', async () => {
      const m = buildService();
      m.identitiesRepository.findByEmail.mockResolvedValue(undefined);
      await expect(m.service.login({ email: 'nobody@example.com', password: 'x' }, {})).rejects.toThrow(
        'Invalid email or password.',
      );
      expect(m.passwordService.verify).toHaveBeenCalled();
    });

    it('rejects a disabled identity with the same generic message', async () => {
      const m = buildService();
      m.identitiesRepository.findByEmail.mockResolvedValue({ ...ACTIVE_IDENTITY, status: 'disabled' });
      await expect(m.service.login({ email: ACTIVE_IDENTITY.email, password: 'x' }, {})).rejects.toThrow(
        'Invalid email or password.',
      );
      expect(m.passwordService.verify).toHaveBeenCalledWith(expect.any(String), 'x');
    });

    it('rejects a pending_credential identity (NULL hash) with the same generic message — never a users.password_hash fallback', async () => {
      const m = buildService();
      m.identitiesRepository.findByEmail.mockResolvedValue({ ...ACTIVE_IDENTITY, status: 'pending_credential', passwordHash: null });
      await expect(m.service.login({ email: ACTIVE_IDENTITY.email, password: 'x' }, {})).rejects.toThrow(
        'Invalid email or password.',
      );
    });

    it('rejects a wrong password against identities.password_hash', async () => {
      const m = buildService();
      m.identitiesRepository.findByEmail.mockResolvedValue(ACTIVE_IDENTITY);
      m.passwordService.verify.mockResolvedValue(false);
      await expect(m.service.login({ email: ACTIVE_IDENTITY.email, password: 'wrong' }, {})).rejects.toThrow(
        'Invalid email or password.',
      );
      expect(m.passwordService.verify).toHaveBeenCalledWith('stored-identity-hash', 'wrong');
    });

    it('rejects when the identity has no active memberships (generic message — no enumeration)', async () => {
      const m = buildService();
      m.identitiesRepository.findByEmail.mockResolvedValue(ACTIVE_IDENTITY);
      m.passwordService.verify.mockResolvedValue(true);
      m.tenantMembershipsRepository.listActiveForIdentity.mockResolvedValue([]);
      await expect(m.service.login({ email: ACTIVE_IDENTITY.email, password: 'ok' }, {})).rejects.toThrow(
        'Invalid email or password.',
      );
    });

    it('with exactly one active membership, issues a session directly', async () => {
      const m = buildService();
      m.identitiesRepository.findByEmail.mockResolvedValue(ACTIVE_IDENTITY);
      m.passwordService.verify.mockResolvedValue(true);
      m.tenantMembershipsRepository.listActiveForIdentity.mockResolvedValue([MEMBERSHIP_A]);

      const result = await m.service.login({ email: ACTIVE_IDENTITY.email, password: 'ok' }, {});

      expect(result.kind).toBe('session');
      if (result.kind !== 'session') return;
      expect(result.user.tenantId).toBe('tenant-a');
      expect(result.user.identityId).toBe('identity-1');
      expect(m.identitiesRepository.touchLastLogin).toHaveBeenCalledWith('identity-1');
      expect(m.accessTokenService.issueSelection).not.toHaveBeenCalled();
    });

    it('with more than one active membership, returns a selection token + the tenant list and NO session', async () => {
      const m = buildService();
      m.identitiesRepository.findByEmail.mockResolvedValue(ACTIVE_IDENTITY);
      m.passwordService.verify.mockResolvedValue(true);
      m.tenantMembershipsRepository.listActiveForIdentity.mockResolvedValue([MEMBERSHIP_A, MEMBERSHIP_B]);

      const result = await m.service.login({ email: ACTIVE_IDENTITY.email, password: 'ok' }, {});

      expect(result.kind).toBe('tenant-selection');
      if (result.kind !== 'tenant-selection') return;
      expect(result.selectionToken).toBe('selection-token');
      expect(result.availableTenants).toEqual([
        { tenantId: 'tenant-a', name: 'Muebles' },
        { tenantId: 'tenant-b', name: 'Electro' },
      ]);
      expect(m.accessTokenService.issue).not.toHaveBeenCalled();
      expect(m.refreshTokensRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('selectTenant', () => {
    const validPayload = { sub: 'identity-1', purpose: 'tenant-selection', jti: 'j1' };

    it('rejects a missing selection token', async () => {
      const m = buildService();
      await expect(m.service.selectTenant(undefined, 'tenant-a', {})).rejects.toThrow('Invalid or expired selection.');
    });

    it('rejects a token that fails verification (expired / bad signature)', async () => {
      const m = buildService();
      m.jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      await expect(m.service.selectTenant('some-token', 'tenant-a', {})).rejects.toThrow('Invalid or expired selection.');
    });

    it('rejects a verified token whose purpose is not tenant-selection (e.g. an access token)', async () => {
      const m = buildService();
      m.jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', tenantId: 't', identityId: 'i', jti: 'j' });
      await expect(m.service.selectTenant('an-access-token', 'tenant-a', {})).rejects.toThrow(
        'Invalid or expired selection.',
      );
    });

    it('rejects when the identity is now disabled', async () => {
      const m = buildService();
      m.jwtService.verifyAsync.mockResolvedValue(validPayload);
      m.identitiesRepository.findById.mockResolvedValue({ ...ACTIVE_IDENTITY, status: 'disabled' });
      await expect(m.service.selectTenant('t', 'tenant-a', {})).rejects.toThrow('Invalid or expired selection.');
    });

    it('rejects when the chosen tenant is not an active membership of this identity', async () => {
      const m = buildService();
      m.jwtService.verifyAsync.mockResolvedValue(validPayload);
      m.identitiesRepository.findById.mockResolvedValue(ACTIVE_IDENTITY);
      m.tenantMembershipsRepository.findActiveForIdentityAndTenant.mockResolvedValue(undefined);
      await expect(m.service.selectTenant('t', 'tenant-x', {})).rejects.toThrow('Invalid or expired selection.');
      expect(m.tenantMembershipsRepository.findActiveForIdentityAndTenant).toHaveBeenCalledWith('identity-1', 'tenant-x');
    });

    it('issues a session for the selected tenant when the membership is valid', async () => {
      const m = buildService();
      m.jwtService.verifyAsync.mockResolvedValue(validPayload);
      m.identitiesRepository.findById.mockResolvedValue(ACTIVE_IDENTITY);
      m.tenantMembershipsRepository.findActiveForIdentityAndTenant.mockResolvedValue(MEMBERSHIP_B);
      m.usersRepository.findById.mockResolvedValue({ ...ACTIVE_USER_A, id: 'user-b', tenantId: 'tenant-b' });

      const session = await m.service.selectTenant('t', 'tenant-b', {});

      expect(session.kind).toBe('session');
      expect(session.user.tenantId).toBe('tenant-b');
      expect(m.accessTokenService.issue).toHaveBeenCalledWith('user-b', 'identity-1', 'tenant-b', 'electro');
    });
  });

  describe('refresh', () => {
    const REFRESH_ROW = {
      id: 'rt-1',
      tenantId: 'tenant-a',
      tenantSlug: 'muebles',
      userId: 'user-a',
      expiresAt: new Date(Date.now() + 100_000),
      revokedAt: null,
    };

    it('rejects when no token is presented', async () => {
      const m = buildService();
      await expect(m.service.refresh(undefined, {})).rejects.toThrow('Invalid or expired session.');
    });

    it('treats reuse of a revoked token as theft and revokes every session', async () => {
      const m = buildService();
      m.refreshTokensPlatformRepository.findByHash.mockResolvedValue({ ...REFRESH_ROW, revokedAt: new Date() });
      await expect(m.service.refresh('reused', {})).rejects.toThrow('Invalid or expired session.');
      expect(m.refreshTokensRepository.revokeAllForUser).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'user-a');
    });

    it('rejects when the membership/tenant/identity/user is no longer active, without revoking the token', async () => {
      const m = buildService();
      m.refreshTokensPlatformRepository.findByHash.mockResolvedValue(REFRESH_ROW);
      m.tenantMembershipsRepository.findActiveForTenantAndUser.mockResolvedValue(undefined);
      await expect(m.service.refresh('valid', {})).rejects.toThrow('Invalid or expired session.');
      expect(m.refreshTokensRepository.revoke).not.toHaveBeenCalled();
    });

    it('rotates and re-issues an access token carrying the identity id', async () => {
      const m = buildService();
      m.refreshTokensPlatformRepository.findByHash.mockResolvedValue(REFRESH_ROW);
      m.tenantMembershipsRepository.findActiveForTenantAndUser.mockResolvedValue(MEMBERSHIP_A);
      m.usersRepository.findById.mockResolvedValue(ACTIVE_USER_A);

      const session = await m.service.refresh('valid', {});

      expect(m.refreshTokensRepository.revoke).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'rt-1');
      expect(m.refreshTokensRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rotatedFromId: 'rt-1' }),
      );
      expect(m.accessTokenService.issue).toHaveBeenCalledWith('user-a', 'identity-1', 'tenant-a', 'muebles');
      expect(session.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('me', () => {
    it('returns the current user view with identityId and without the password hash', async () => {
      const m = buildService();
      m.usersRepository.findById.mockResolvedValue(ACTIVE_USER_A);
      const view = await m.service.me('user-a', 'identity-1', 'tenant-a', 'muebles');
      expect(view).not.toHaveProperty('passwordHash');
      expect(view).toMatchObject({ id: 'user-a', identityId: 'identity-1', tenantId: 'tenant-a', tenantSlug: 'muebles' });
    });

    it('rejects if the user was disabled/deleted since the token was issued', async () => {
      const m = buildService();
      m.usersRepository.findById.mockResolvedValue(undefined);
      await expect(m.service.me('user-a', 'identity-1', 'tenant-a', 'muebles')).rejects.toThrow(UnauthorizedException);
    });
  });
});
