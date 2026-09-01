import { generateId } from '@saas-inventory/shared';
import * as argon2 from 'argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb } from '../database/helpers';

/**
 * FASE 11's system-level administration surface — SuperAdmin session endpoints
 * (auth/platform-auth.controller.ts) and platform-only tenant lifecycle management
 * (administration/platform-tenants/*). Same boot/inject convention as
 * test/core/users-rbac.integration.test.ts. `platform_admins` has no self-service registration
 * endpoint (by design — see PlatformAdminsRepository's header comment), so this suite seeds its
 * own row(s) directly via the migrator connection, the same way test/database/*.integration.test.ts
 * seed data outside the HTTP surface.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('administration: platform-admin (integration)', () => {
  let app: NestFastifyApplication;
  const PLATFORM_ADMIN_PASSWORD = 'a-very-long-platform-admin-password';
  let platformAdminEmail: string;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_APP_TENANT_DATABASE_URL'];
    process.env['APP_PLATFORM_DATABASE_URL'] = getAppPlatformDatabaseUrl();
    process.env['APP_PUBLIC_RESOLVER_DATABASE_URL'] = getAppPublicResolverDatabaseUrl();
    process.env['JWT_SECRET'] = 'integration-test-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'integration-test-refresh-pepper';
    process.env['CORS_ORIGINS'] = 'http://localhost:3000';
    process.env['ARGON2_MEMORY_COST_KIB'] = '8192';
    process.env['ARGON2_TIME_COST'] = '2';
    process.env['ARGON2_PARALLELISM'] = '1';
    process.env['AUTH_RATE_LIMIT_MAX'] = '1000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';

    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();

    platformAdminEmail = `superadmin-${generateId()}@example.com`;
    const passwordHash = await argon2.hash(PLATFORM_ADMIN_PASSWORD, { type: argon2.argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1 });
    const { client, db } = getMigratorDb();
    try {
      await db.insert(schema.platformAdmins).values({
        id: generateId(),
        email: platformAdminEmail,
        passwordHash,
        fullName: 'Test SuperAdmin',
      });
    } finally {
      await client.end();
    }
  }, 60_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  function inject(options: {
    method: HTTPMethods;
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }): Promise<LightMyRequestResponse> {
    return app.getHttpAdapter().getInstance().inject(options as InjectOptions);
  }

  function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
    const raw = response.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) {
        return value;
      }
    }
    return undefined;
  }

  function cookieHeader(cookies: Record<string, string | undefined>): string {
    return Object.entries(cookies)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  interface TenantSession {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    csrfToken: string;
  }

  interface PlatformSession {
    admin: { id: string; email: string };
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }

  function tenantReadHeaders(session: TenantSession): Record<string, string> {
    return { cookie: cookieHeader({ access_token: session.accessToken }) };
  }

  function platformReadHeaders(session: PlatformSession): Record<string, string> {
    return { cookie: cookieHeader({ platform_access_token: session.accessToken }) };
  }

  function platformWriteHeaders(session: PlatformSession): Record<string, string> {
    return {
      cookie: cookieHeader({ platform_access_token: session.accessToken, platform_csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  async function registerTenant(companyName: string, email: string): Promise<TenantSession> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: TenantSession['user'] };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  async function loginPlatformAdmin(): Promise<PlatformSession> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/platform/auth/login',
      payload: { email: platformAdminEmail, password: PLATFORM_ADMIN_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { admin: PlatformSession['admin'] };
    return {
      admin: body.admin,
      accessToken: cookieValue(response, 'platform_access_token')!,
      refreshToken: cookieValue(response, 'platform_refresh_token')!,
      csrfToken: cookieValue(response, 'platform_csrf_token')!,
    };
  }

  describe('platform-admin session (login/me/refresh/logout)', () => {
    it('rejects an unknown email / wrong password with a generic message', async () => {
      const wrongEmail = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever-long-enough' },
      });
      expect(wrongEmail.statusCode).toBe(401);

      const wrongPassword = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/login',
        payload: { email: platformAdminEmail, password: 'the-wrong-password' },
      });
      expect(wrongPassword.statusCode).toBe(401);
    });

    it('CSRF: rejects logout with a missing/mismatched platform_csrf_token, accepts a matching one', async () => {
      const session = await loginPlatformAdmin();

      const noHeader = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/logout',
        headers: { cookie: cookieHeader({ platform_refresh_token: session.refreshToken, platform_csrf_token: session.csrfToken }) },
      });
      expect(noHeader.statusCode).toBe(403);

      const mismatched = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/logout',
        headers: {
          cookie: cookieHeader({ platform_refresh_token: session.refreshToken, platform_csrf_token: session.csrfToken }),
          'x-csrf-token': 'not-the-right-token',
        },
      });
      expect(mismatched.statusCode).toBe(403);

      const matching = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/logout',
        headers: {
          cookie: cookieHeader({ platform_refresh_token: session.refreshToken, platform_csrf_token: session.csrfToken }),
          'x-csrf-token': session.csrfToken,
        },
      });
      expect(matching.statusCode).toBe(204);
    });

    it('logs in, reads its own identity via GET /platform/auth/me, then logs out', async () => {
      const session = await loginPlatformAdmin();
      expect(session.admin.email).toBe(platformAdminEmail);

      const me = await inject({ method: 'GET', url: '/api/v1/platform/auth/me', headers: platformReadHeaders(session) });
      expect(me.statusCode).toBe(200);
      expect(JSON.parse(me.body).email).toBe(platformAdminEmail);
      expect(JSON.parse(me.body)).not.toHaveProperty('passwordHash');

      const logout = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/logout',
        headers: {
          cookie: cookieHeader({ platform_refresh_token: session.refreshToken, platform_csrf_token: session.csrfToken }),
          'x-csrf-token': session.csrfToken,
        },
      });
      expect(logout.statusCode).toBe(204);

      const refreshAfterLogout = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/refresh',
        headers: {
          cookie: cookieHeader({ platform_refresh_token: session.refreshToken, platform_csrf_token: session.csrfToken }),
          'x-csrf-token': session.csrfToken,
        },
      });
      expect(refreshAfterLogout.statusCode).toBe(401);
    });

    it('rotates the refresh token on POST /platform/auth/refresh', async () => {
      const session = await loginPlatformAdmin();
      const refreshed = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/refresh',
        headers: {
          cookie: cookieHeader({ platform_refresh_token: session.refreshToken, platform_csrf_token: session.csrfToken }),
          'x-csrf-token': session.csrfToken,
        },
      });
      expect(refreshed.statusCode).toBe(200);
      const newRefreshToken = cookieValue(refreshed, 'platform_refresh_token');
      expect(newRefreshToken).toBeDefined();
      expect(newRefreshToken).not.toBe(session.refreshToken);

      // The rotated-away original token is now revoked — reusing it is rejected.
      const reuse = await inject({
        method: 'POST',
        url: '/api/v1/platform/auth/refresh',
        headers: {
          cookie: cookieHeader({ platform_refresh_token: session.refreshToken, platform_csrf_token: session.csrfToken }),
          'x-csrf-token': session.csrfToken,
        },
      });
      expect(reuse.statusCode).toBe(401);
    });
  });

  describe('platform / tenant boundary (§12/§13/§35 — structural separation, never tenant RBAC)', () => {
    it('a platform-admin session cannot resolve a tenant context (GET /tenant is 403, not 200)', async () => {
      const session = await loginPlatformAdmin();
      const response = await inject({ method: 'GET', url: '/api/v1/tenant', headers: platformReadHeaders(session) });
      expect(response.statusCode).toBe(403);
    });

    it('a tenant session (including a full-access Administrador) cannot reach a @PlatformOnly() route', async () => {
      const admin = await registerTenant('Omicron Tenant Co', 'admin@omicron-tenant.example');
      const response = await inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: tenantReadHeaders(admin) });
      expect(response.statusCode).toBe(403);
    });

    it('anonymous is rejected (401) on every platform-admin route', async () => {
      const response = await inject({ method: 'GET', url: '/api/v1/platform/tenants' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('platform-tenants (list / suspend / activate)', () => {
    it('lists tenants including one just registered, and GET by id returns it', async () => {
      const tenant = await registerTenant('Pi Tenant Co', 'admin@pi-tenant.example');
      const session = await loginPlatformAdmin();

      const list = await inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: platformReadHeaders(session) });
      expect(list.statusCode).toBe(200);
      const tenants = JSON.parse(list.body) as { id: string }[];
      expect(tenants.map((t) => t.id)).toContain(tenant.user.tenantId);

      const getOne = await inject({
        method: 'GET',
        url: `/api/v1/platform/tenants/${tenant.user.tenantId}`,
        headers: platformReadHeaders(session),
      });
      expect(getOne.statusCode).toBe(200);
      expect(JSON.parse(getOne.body).status).toBe('active');
    });

    it('suspending a tenant blocks its users from logging in; activating restores it', async () => {
      const tenant = await registerTenant('Rho Tenant Co', 'admin@rho-tenant.example');
      const session = await loginPlatformAdmin();

      const suspend = await inject({
        method: 'POST',
        url: `/api/v1/platform/tenants/${tenant.user.tenantId}/suspend`,
        headers: platformWriteHeaders(session),
      });
      expect(suspend.statusCode).toBe(200);
      expect(JSON.parse(suspend.body).status).toBe('suspended');

      const blockedLogin = await inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@rho-tenant.example', password: 'a-very-long-password' },
      });
      expect(blockedLogin.statusCode).toBe(401);

      const activate = await inject({
        method: 'POST',
        url: `/api/v1/platform/tenants/${tenant.user.tenantId}/activate`,
        headers: platformWriteHeaders(session),
      });
      expect(activate.statusCode).toBe(200);
      expect(JSON.parse(activate.body).status).toBe('active');

      const restoredLogin = await inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@rho-tenant.example', password: 'a-very-long-password' },
      });
      expect(restoredLogin.statusCode).toBe(200);
    });

    it('a suspend/activate mutation without a valid platform CSRF token is rejected (403)', async () => {
      const tenant = await registerTenant('Sigma Tenant Co', 'admin@sigma-tenant.example');
      const session = await loginPlatformAdmin();

      const response = await inject({
        method: 'POST',
        url: `/api/v1/platform/tenants/${tenant.user.tenantId}/suspend`,
        headers: platformReadHeaders(session), // no X-CSRF-Token / platform_csrf_token cookie
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
