import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthConfig } from '../../common/config/auth-config';
import { PasswordService } from './password.service';

const testAuthConfig: AuthConfig = {
  jwtSecret: 'test-jwt-secret',
  refreshTokenPepper: 'test-refresh-pepper',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  argon2: { memoryCostKib: 8192, timeCost: 2, parallelism: 1 },
  cookieDomain: undefined,
  cookieSecure: false,
  rateLimit: { ttlSeconds: 60, max: 5 },
};

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService(testAuthConfig);
  });

  it('hashes a password as Argon2id, never plaintext or a fast hash', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('verifies a matching password', async () => {
    const hash = await service.hash('correct horse battery staple');
    await expect(service.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects a non-matching password', async () => {
    const hash = await service.hash('correct horse battery staple');
    await expect(service.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt), even for the same input', async () => {
    const [a, b] = await Promise.all([service.hash('same-password'), service.hash('same-password')]);
    expect(a).not.toBe(b);
  });

  it('returns false (not a throw) for a malformed/foreign hash, per the seed-script placeholder case', async () => {
    await expect(service.verify('unset:deadbeef', 'anything')).resolves.toBe(false);
  });
});
