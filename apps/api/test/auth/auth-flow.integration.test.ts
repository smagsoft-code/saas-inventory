import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl } from '../database/helpers';

/**
 * Full HTTP-level auth flow, exercised through the real guard chain (JwtAuthGuard -> TenantGuard
 * -> CsrfGuard -> PermissionsGuard) and the real app_tenant/app_platform database connections —
 * not mocks. Boots the actual application (src/main.ts's buildApp()) and drives it via Fastify's
 * in-process `inject()`, so this is the closest thing to a real request this suite can do without
 * an open port. Skipped (not failed) unless TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL
 * / TEST_APP_PLATFORM_DATABASE_URL are all set — see test/database/helpers.ts.
 *
 * Section 22's mandatory cross-tenant-escalation scenario is covered here (a session cannot be
 * turned into another tenant's session by any means available at this layer) and, at the
 * persistence layer, by the `auth_refresh_tokens` cases added to
 * test/database/multi-tenancy-rls.integration.test.ts.
 *
 * Does NOT call resetAndMigrate() itself — global-setup.ts already resets/migrates exactly once
 * for the whole test:integration run, before any file. Calling it again here raced against that
 * (and against every other *.integration.test.ts file under this config's fileParallelism: true)
 * for a concurrent DROP SCHEMA/CREATE ROLE against the same live database — found running this
 * suite for real against embedded-postgres, Prompt 05-B (surfaced as "relation ... does not
 * exist" / "role ... does not exist" in unrelated files).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('auth flow (integration)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_APP_TENANT_DATABASE_URL'];
    process.env['APP_PLATFORM_DATABASE_URL'] = getAppPlatformDatabaseUrl();
    process.env['JWT_SECRET'] = 'integration-test-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'integration-test-refresh-pepper';
    process.env['CORS_ORIGINS'] = 'http://localhost:3000';
    process.env['ARGON2_MEMORY_COST_KIB'] = '8192';
    process.env['ARGON2_TIME_COST'] = '2';
    process.env['ARGON2_PARALLELISM'] = '1';
    // High enough that this file's own sequence of login attempts (including deliberately wrong
    // ones) never trips the throttle guard itself.
    process.env['AUTH_RATE_LIMIT_MAX'] = '1000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';

    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
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

  async function registerTenant(companyName: string, email: string) {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: { id: string; tenantId: string; tenantSlug: string } };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      refreshToken: cookieValue(response, 'refresh_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  it('registers a new tenant + admin user, never exposing the password hash', async () => {
    const session = await registerTenant('Acme Corp', 'admin@acme-flow-test.example');
    expect(session.user.tenantSlug).toMatch(/^acme-corp/);
    expect(session.user).not.toHaveProperty('passwordHash');
  });

  it('GET /auth/me works with a valid session and rejects with none', async () => {
    const session = await registerTenant('Beta Inc', 'admin@beta-flow-test.example');

    const authed = await inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader({ access_token: session.accessToken }) },
    });
    expect(authed.statusCode).toBe(200);
    const body = JSON.parse(authed.body) as { id: string; passwordHash?: string };
    expect(body.id).toBe(session.user.id);
    expect(body).not.toHaveProperty('passwordHash');

    const unauthed = await inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(unauthed.statusCode).toBe(401);
  });

  it('rejects login with a wrong password, a wrong tenant slug, and an unknown email — all with the same generic message', async () => {
    const session = await registerTenant('Gamma LLC', 'admin@gamma-flow-test.example');

    const wrongPassword = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: session.user.tenantSlug, email: 'admin@gamma-flow-test.example', password: 'wrong' },
    });
    const wrongTenant = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'no-such-tenant-slug', email: 'admin@gamma-flow-test.example', password: 'x' },
    });
    const wrongEmail = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: session.user.tenantSlug, email: 'nobody@gamma-flow-test.example', password: 'x' },
    });

    for (const response of [wrongPassword, wrongTenant, wrongEmail]) {
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).message).toBe('Invalid tenant, email, or password.');
    }
  });

  it('CSRF: rejects a state-changing request with a missing/mismatched token, accepts a matching one', async () => {
    const session = await registerTenant('Delta Co', 'admin@delta-flow-test.example');

    const noHeader = await inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: cookieHeader({ refresh_token: session.refreshToken, csrf_token: session.csrfToken }),
      },
    });
    expect(noHeader.statusCode).toBe(403);

    const mismatched = await inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: cookieHeader({ refresh_token: session.refreshToken, csrf_token: session.csrfToken }),
        'x-csrf-token': 'not-the-right-token',
      },
    });
    expect(mismatched.statusCode).toBe(403);

    const matching = await inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: cookieHeader({ refresh_token: session.refreshToken, csrf_token: session.csrfToken }),
        'x-csrf-token': session.csrfToken,
      },
    });
    expect(matching.statusCode).toBe(204);
  });

  it('refresh rotates the token and revokes the old one; reusing the old token kills the whole session family', async () => {
    const session = await registerTenant('Epsilon Ltd', 'admin@epsilon-flow-test.example');

    const first = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: cookieHeader({ refresh_token: session.refreshToken, csrf_token: session.csrfToken }),
        'x-csrf-token': session.csrfToken,
      },
    });
    expect(first.statusCode).toBe(200);
    const rotatedRefreshToken = cookieValue(first, 'refresh_token')!;
    const rotatedCsrfToken = cookieValue(first, 'csrf_token')!;
    expect(rotatedRefreshToken).not.toBe(session.refreshToken);

    // Reusing the original (now-revoked) token is rejected...
    const reused = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: cookieHeader({ refresh_token: session.refreshToken, csrf_token: session.csrfToken }),
        'x-csrf-token': session.csrfToken,
      },
    });
    expect(reused.statusCode).toBe(401);

    // ...and, per the reuse-detection policy, the entire family is now revoked: even the
    // legitimately-rotated token issued moments ago no longer works.
    const rotatedNowRevoked = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: cookieHeader({ refresh_token: rotatedRefreshToken, csrf_token: rotatedCsrfToken }),
        'x-csrf-token': rotatedCsrfToken,
      },
    });
    expect(rotatedNowRevoked.statusCode).toBe(401);
  });

  describe('cross-tenant escalation (Prompt 04 §22, mandatory)', () => {
    it("tenant A's session never resolves to tenant B's identity, no matter what is combined", async () => {
      const tenantA = await registerTenant('Zeta Corp', 'admin@zeta-flow-test.example');
      const tenantB = await registerTenant('Omega Corp', 'admin@omega-flow-test.example');
      expect(tenantA.user.tenantId).not.toBe(tenantB.user.tenantId);

      // Tenant A's access token, combined with tenant B's csrf cookie/header (an attacker mixing
      // artifacts from two different sessions), still resolves to tenant A on /me — the tenant
      // is read only from the verified access token, never influenced by any other cookie.
      const mixed = await inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: cookieHeader({ access_token: tenantA.accessToken, csrf_token: tenantB.csrfToken }) },
      });
      expect(mixed.statusCode).toBe(200);
      expect(JSON.parse(mixed.body).tenantId).toBe(tenantA.user.tenantId);

      // Attempting to log into tenant B's slug using tenant A's admin email fails generically —
      // proves the (tenantSlug, email) pair is what's checked, not email alone.
      const crossLogin = await inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { tenantSlug: tenantB.user.tenantSlug, email: 'admin@zeta-flow-test.example', password: 'a-very-long-password' },
      });
      expect(crossLogin.statusCode).toBe(401);

      // Tenant B's refresh token, presented on its own, always resolves to tenant B — never
      // tenant A, even though the endpoint itself carries no tenant-identifying input at all.
      const refreshB = await inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: cookieHeader({ refresh_token: tenantB.refreshToken, csrf_token: tenantB.csrfToken }),
          'x-csrf-token': tenantB.csrfToken,
        },
      });
      expect(refreshB.statusCode).toBe(200);
      expect(JSON.parse(refreshB.body).user.tenantId).toBe(tenantB.user.tenantId);
    });
  });
});
