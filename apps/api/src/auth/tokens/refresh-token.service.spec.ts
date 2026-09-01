import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthConfig } from '../../common/config/auth-config';
import { RefreshTokenService } from './refresh-token.service';

const testAuthConfig: AuthConfig = {
  jwtSecret: 'test-jwt-secret',
  refreshTokenPepper: 'test-refresh-pepper',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  selectionTokenTtlSeconds: 300,
  argon2: { memoryCostKib: 8192, timeCost: 1, parallelism: 1 },
  cookieDomain: undefined,
  cookieSecure: false,
  rateLimit: { ttlSeconds: 60, max: 5 },
};

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  beforeEach(() => {
    service = new RefreshTokenService(testAuthConfig);
  });

  it('generates a high-entropy opaque token, distinct from its stored hash', () => {
    const generated = service.generate();
    expect(generated.token).not.toBe(generated.tokenHash);
    expect(generated.token.length).toBeGreaterThanOrEqual(32);
    expect(generated.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets an expiry consistent with the configured TTL', () => {
    const before = Date.now();
    const generated = service.generate();
    const expectedExpiry = before + testAuthConfig.refreshTokenTtlSeconds * 1000;
    expect(Math.abs(generated.expiresAt.getTime() - expectedExpiry)).toBeLessThan(2000);
  });

  it('generates two different tokens (and hashes) on successive calls', () => {
    const a = service.generate();
    const b = service.generate();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('hash() is deterministic for the same token (needed to look it up later)', () => {
    const generated = service.generate();
    expect(service.hash(generated.token)).toBe(generated.tokenHash);
  });

  it('hashing depends on the pepper — a different secret yields a different hash', () => {
    const generated = service.generate();
    const otherService = new RefreshTokenService({ ...testAuthConfig, refreshTokenPepper: 'different-pepper' });
    expect(otherService.hash(generated.token)).not.toBe(generated.tokenHash);
  });
});
