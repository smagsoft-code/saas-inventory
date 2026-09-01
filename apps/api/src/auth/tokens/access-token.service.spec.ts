import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthConfig } from '../../common/config/auth-config';
import { AccessTokenService } from './access-token.service';

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

describe('AccessTokenService', () => {
  let service: AccessTokenService;
  let jwtService: JwtService;

  beforeEach(() => {
    jwtService = new JwtService({});
    service = new AccessTokenService(jwtService, testAuthConfig);
  });

  it('issues a signed JWT carrying sub/identityId/tenantId/tenantSlug and a short TTL', async () => {
    const issued = await service.issue('user-1', 'identity-1', 'tenant-1', 'acme');
    expect(issued.expiresInSeconds).toBe(900);

    const payload = await jwtService.verifyAsync(issued.token, { secret: 'test-jwt-secret' });
    expect(payload.sub).toBe('user-1');
    expect(payload.identityId).toBe('identity-1');
    expect(payload.tenantId).toBe('tenant-1');
    expect(payload.tenantSlug).toBe('acme');
    expect(typeof payload.jti).toBe('string');
  });

  it('rejects verification with the wrong secret', async () => {
    const issued = await service.issue('user-1', 'identity-1', 'tenant-1', 'acme');
    await expect(jwtService.verifyAsync(issued.token, { secret: 'wrong-secret' })).rejects.toThrow();
  });

  it('issues a different jti each time', async () => {
    const a = await service.issue('user-1', 'identity-1', 'tenant-1', 'acme');
    const b = await service.issue('user-1', 'identity-1', 'tenant-1', 'acme');
    const payloadA = jwtService.decode<{ jti: string }>(a.token);
    const payloadB = jwtService.decode<{ jti: string }>(b.token);
    expect(payloadA.jti).not.toBe(payloadB.jti);
  });

  it('issues a tenant-selection token carrying only the identity id and a purpose, with the selection TTL', async () => {
    const issued = await service.issueSelection('identity-1');
    expect(issued.expiresInSeconds).toBe(300);
    const payload = await jwtService.verifyAsync(issued.token, { secret: 'test-jwt-secret' });
    expect(payload.sub).toBe('identity-1');
    expect(payload.purpose).toBe('tenant-selection');
    expect(payload.tenantId).toBeUndefined();
    expect(payload.identityId).toBeUndefined();
  });

  it('issues a platform token carrying sub/context but never tenantId/tenantSlug', async () => {
    const issued = await service.issuePlatform('admin-1');
    const payload = await jwtService.verifyAsync(issued.token, { secret: 'test-jwt-secret' });
    expect(payload.sub).toBe('admin-1');
    expect(payload.context).toBe('global');
    expect(payload.tenantId).toBeUndefined();
    expect(payload.tenantSlug).toBeUndefined();
  });
});
