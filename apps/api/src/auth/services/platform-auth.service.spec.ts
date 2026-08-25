import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { PlatformAuthService } from './platform-auth.service';

/** Mirrors auth/services/auth.service.spec.ts's mocking convention, applied to the structurally
 * separate SuperAdmin login path — no withTenantTransaction mock needed since PlatformAuthService
 * never opens one (there is no tenant). */
const ACTIVE_ADMIN = {
  id: 'admin-1',
  email: 'root@example.com',
  passwordHash: 'stored-hash',
  fullName: 'Root Admin',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const platformAdminsRepository = { findByEmail: vi.fn(), findById: vi.fn() };
  const platformRefreshTokensRepository = {
    create: vi.fn(),
    findByHash: vi.fn(),
    revoke: vi.fn(),
    revokeAllForAdmin: vi.fn(),
  };
  const passwordService = { verify: vi.fn() };
  const accessTokenService = { issuePlatform: vi.fn().mockResolvedValue({ token: 'access-token', expiresInSeconds: 900 }) };
  const refreshTokenService = {
    generate: vi
      .fn()
      .mockReturnValue({ token: 'raw-refresh', tokenHash: 'hashed-refresh', expiresAt: new Date(Date.now() + 1000) }),
    hash: vi.fn().mockReturnValue('hashed-refresh'),
  };
  const csrfTokenService = { generate: vi.fn().mockReturnValue('csrf-token') };

  const service = new PlatformAuthService(
    platformAdminsRepository as never,
    platformRefreshTokensRepository as never,
    passwordService as never,
    accessTokenService as never,
    refreshTokenService as never,
    csrfTokenService as never,
  );

  return { service, platformAdminsRepository, platformRefreshTokensRepository, passwordService, accessTokenService, refreshTokenService };
}

describe('PlatformAuthService', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  describe('login', () => {
    it('rejects an unknown email with the generic message and still runs a dummy hash verify', async () => {
      harness.platformAdminsRepository.findByEmail.mockResolvedValue(undefined);
      await expect(harness.service.login({ email: 'nobody@example.com', password: 'x' }, {})).rejects.toThrow(
        'Invalid email or password.',
      );
      expect(harness.passwordService.verify).toHaveBeenCalled();
    });

    it('rejects a disabled admin with the same generic message', async () => {
      harness.platformAdminsRepository.findByEmail.mockResolvedValue({ ...ACTIVE_ADMIN, status: 'disabled' });
      await expect(harness.service.login({ email: ACTIVE_ADMIN.email, password: 'x' }, {})).rejects.toThrow(
        'Invalid email or password.',
      );
    });

    it('rejects a wrong password with the same generic message', async () => {
      harness.platformAdminsRepository.findByEmail.mockResolvedValue(ACTIVE_ADMIN);
      harness.passwordService.verify.mockResolvedValue(false);
      await expect(harness.service.login({ email: ACTIVE_ADMIN.email, password: 'wrong' }, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues a session on valid credentials, never exposing the password hash', async () => {
      harness.platformAdminsRepository.findByEmail.mockResolvedValue(ACTIVE_ADMIN);
      harness.passwordService.verify.mockResolvedValue(true);

      const session = await harness.service.login({ email: ACTIVE_ADMIN.email, password: 'correct' }, {});

      expect(session.accessToken).toBe('access-token');
      expect(session.admin).not.toHaveProperty('passwordHash');
      expect(harness.accessTokenService.issuePlatform).toHaveBeenCalledWith('admin-1');
    });
  });

  describe('refresh', () => {
    it('rejects when no token is presented', async () => {
      await expect(harness.service.refresh(undefined, {})).rejects.toThrow('Invalid or expired session.');
    });

    it('treats a revoked (already-rotated) token being reused as possible theft and revokes every session', async () => {
      harness.platformRefreshTokensRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        platformAdminId: 'admin-1',
        tokenHash: 'hashed-refresh',
        expiresAt: new Date(Date.now() + 100_000),
        revokedAt: new Date(),
      });
      await expect(harness.service.refresh('reused-token', {})).rejects.toThrow('Invalid or expired session.');
      expect(harness.platformRefreshTokensRepository.revokeAllForAdmin).toHaveBeenCalledWith('admin-1');
    });

    it('rotates: revokes the old token and issues a new one on success', async () => {
      harness.platformRefreshTokensRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        platformAdminId: 'admin-1',
        tokenHash: 'hashed-refresh',
        expiresAt: new Date(Date.now() + 100_000),
        revokedAt: null,
      });
      harness.platformAdminsRepository.findById.mockResolvedValue(ACTIVE_ADMIN);

      const session = await harness.service.refresh('valid-token', {});

      expect(harness.platformRefreshTokensRepository.revoke).toHaveBeenCalledWith('rt-1');
      expect(harness.platformRefreshTokensRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ rotatedFromId: 'rt-1' }),
      );
      expect(session.admin.id).toBe('admin-1');
    });
  });

  describe('logout', () => {
    it('is a no-op (succeeds) when no token is presented', async () => {
      await expect(harness.service.logout(undefined)).resolves.toBeUndefined();
      expect(harness.platformRefreshTokensRepository.revoke).not.toHaveBeenCalled();
    });

    it('revokes the presented token', async () => {
      harness.platformRefreshTokensRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        platformAdminId: 'admin-1',
        tokenHash: 'hashed-refresh',
        expiresAt: new Date(Date.now() + 100_000),
        revokedAt: null,
      });
      await harness.service.logout('valid-token');
      expect(harness.platformRefreshTokensRepository.revoke).toHaveBeenCalledWith('rt-1');
    });
  });

  describe('me', () => {
    it('returns the current admin view without the password hash', async () => {
      harness.platformAdminsRepository.findById.mockResolvedValue(ACTIVE_ADMIN);
      const view = await harness.service.me('admin-1');
      expect(view).not.toHaveProperty('passwordHash');
      expect(view).toEqual({ id: 'admin-1', email: ACTIVE_ADMIN.email, fullName: ACTIVE_ADMIN.fullName, status: 'active' });
    });

    it('rejects if the admin no longer exists or is disabled', async () => {
      harness.platformAdminsRepository.findById.mockResolvedValue(undefined);
      await expect(harness.service.me('admin-1')).rejects.toThrow('Invalid or expired session.');
    });
  });
});
