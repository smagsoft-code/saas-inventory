import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthConfig } from '../config/auth-config';
import { JwtAuthGuard } from './jwt-auth.guard';

const testAuthConfig: AuthConfig = {
  jwtSecret: 'test-secret',
  refreshTokenPepper: 'test-pepper',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  selectionTokenTtlSeconds: 300,
  invitationTokenTtlSeconds: 604800,
  supportSessionTtlSeconds: 1800,
  argon2: { memoryCostKib: 8192, timeCost: 1, parallelism: 1 },
  cookieDomain: undefined,
  cookieSecure: false,
  rateLimit: { ttlSeconds: 60, max: 5 },
};

function contextFor(request: Record<string, unknown>, isPublic = false): {
  context: ExecutionContext;
  reflector: Reflector;
} {
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('JwtAuthGuard', () => {
  let jwtService: JwtService;

  beforeEach(() => {
    jwtService = new JwtService({});
  });

  it('allows a @Public() route through without a token', async () => {
    const { context, reflector } = contextFor({ headers: {} }, true);
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a request with no token at all', async () => {
    const { context, reflector } = contextFor({ headers: {} });
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid/forged token', async () => {
    const { context, reflector } = contextFor({ headers: { authorization: 'Bearer not-a-real-token' } });
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired session.');
  });

  it('rejects an expired token', async () => {
    const token = await jwtService.signAsync(
      { sub: 'u1', identityId: 'i1', tenantId: 't1', tenantSlug: 'acme', jti: 'j1' },
      { secret: 'test-secret', expiresIn: -10 },
    );
    const { context, reflector } = contextFor({ headers: { authorization: `Bearer ${token}` } });
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired session.');
  });

  it('accepts a valid bearer token and attaches the principal (with identityId) to the request', async () => {
    const token = await jwtService.signAsync(
      { sub: 'u1', identityId: 'i1', tenantId: 't1', tenantSlug: 'acme', jti: 'j1' },
      { secret: 'test-secret', expiresIn: 900 },
    );
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
    const { context, reflector } = contextFor(request);
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['authPrincipal']).toEqual({ userId: 'u1', identityId: 'i1', tenantId: 't1', tenantSlug: 'acme' });
  });

  it('rejects a tenant-selection token used as a session (016-C)', async () => {
    const token = await jwtService.signAsync(
      { sub: 'i1', purpose: 'tenant-selection', jti: 'j1' },
      { secret: 'test-secret', expiresIn: 300 },
    );
    const { context, reflector } = contextFor({ headers: { authorization: `Bearer ${token}` } });
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired session.');
  });

  it('accepts a valid token from the access_token cookie when no bearer header is present', async () => {
    const token = await jwtService.signAsync(
      { sub: 'u1', identityId: 'i1', tenantId: 't1', tenantSlug: 'acme', jti: 'j1' },
      { secret: 'test-secret', expiresIn: 900 },
    );
    const request: Record<string, unknown> = { headers: {}, cookies: { access_token: token } };
    const { context, reflector } = contextFor(request);
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('accepts a valid platform token from the platform_access_token cookie and sets platformPrincipal, never authPrincipal', async () => {
    const token = await jwtService.signAsync(
      { sub: 'admin-1', context: 'global', jti: 'j1' },
      { secret: 'test-secret', expiresIn: 900 },
    );
    const request: Record<string, unknown> = { headers: {}, cookies: { platform_access_token: token } };
    const { context, reflector } = contextFor(request);
    const guard = new JwtAuthGuard(reflector, jwtService, testAuthConfig);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['platformPrincipal']).toEqual({ adminId: 'admin-1' });
    expect(request['authPrincipal']).toBeUndefined();
  });
});
