import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';

/**
 * FASE 11's tenant-configuration surface (administration/tenant-settings/*), exercised through the
 * real guard chain and real app_tenant/app_platform connections — same boot/inject convention as
 * test/core/users-rbac.integration.test.ts. Skipped (not failed) unless
 * TEST_MIGRATOR_DATABASE_URL/TEST_APP_TENANT_DATABASE_URL/TEST_APP_PLATFORM_DATABASE_URL are all
 * set — see test/database/helpers.ts. Does NOT call resetAndMigrate() itself (global-setup.ts
 * already does this once for the whole run — see the identical comment in
 * test/core/users-rbac.integration.test.ts for why).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('administration: tenant-settings (integration)', () => {
  let app: NestFastifyApplication;

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

  interface Session {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    csrfToken: string;
  }

  function readHeaders(session: Session): Record<string, string> {
    return { cookie: cookieHeader({ access_token: session.accessToken }) };
  }

  function writeHeaders(session: Session): Record<string, string> {
    return {
      cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  async function registerTenant(companyName: string, email: string): Promise<Session> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  async function loginAs(email: string, password: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  async function createAndLoginLowPrivilegeUser(admin: Session, email: string): Promise<Session> {
    const rolesResponse = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    const roles = JSON.parse(rolesResponse.body) as { id: string; name: string }[];
    const vendedorRoleId = roles.find((r) => r.name === 'Vendedor')?.id;
    if (!vendedorRoleId) throw new Error('Vendedor role not found');

    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: 'Low Privilege', password: 'a-very-long-password', roleId: vendedorRoleId },
    });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(email, 'a-very-long-password');
  }

  describe('effective configuration defaults', () => {
    it('GET returns system defaults (UTC, []) with updatedAt=null for a freshly registered tenant', async () => {
      const admin = await registerTenant('Zeta Tenant Co', 'admin@zeta-tenant.example');
      const response = await inject({ method: 'GET', url: '/api/v1/administration/tenant-settings', headers: readHeaders(admin) });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        timezone: 'UTC',
        businessHours: [],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: null,
      });
    });
  });

  describe('update (§16 PATCH)', () => {
    it('updates timezone and businessHours, and a later GET reflects the effective value', async () => {
      const admin = await registerTenant('Eta Tenant Co', 'admin@eta-tenant.example');

      const patched = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: {
          timezone: 'America/Bogota',
          businessHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
        },
      });
      expect(patched.statusCode).toBe(200);
      const patchedBody = JSON.parse(patched.body);
      expect(patchedBody.timezone).toBe('America/Bogota');
      expect(patchedBody.businessHours).toEqual([{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }]);
      expect(patchedBody.updatedAt).not.toBeNull();

      const after = await inject({ method: 'GET', url: '/api/v1/administration/tenant-settings', headers: readHeaders(admin) });
      expect(JSON.parse(after.body)).toEqual(patchedBody);
    });

    it('a partial PATCH (timezone only) leaves businessHours at its previously effective value', async () => {
      const admin = await registerTenant('Theta Tenant Co', 'admin@theta-tenant.example');
      await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: { businessHours: [{ dayOfWeek: 2, opensAt: '08:00', closesAt: '17:00' }] },
      });

      const second = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: { timezone: 'America/Bogota' },
      });
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body).businessHours).toEqual([{ dayOfWeek: 2, opensAt: '08:00', closesAt: '17:00' }]);
    });

    it('F17-TRANSFERS-AUDIT §1: updates transfersRequireApproval/transfersRequirePreparation independently, and a partial PATCH leaves the other one at its previously effective value', async () => {
      const admin = await registerTenant('Kappa Tenant Co', 'admin@kappa-tenant.example');

      const first = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: { transfersRequireApproval: false },
      });
      expect(first.statusCode).toBe(200);
      expect(JSON.parse(first.body)).toEqual(
        expect.objectContaining({ transfersRequireApproval: false, transfersRequirePreparation: true }),
      );

      const second = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: { transfersRequirePreparation: false },
      });
      expect(second.statusCode).toBe(200);
      // transfersRequireApproval (false, set above) survives this second, unrelated PATCH.
      expect(JSON.parse(second.body)).toEqual(
        expect.objectContaining({ transfersRequireApproval: false, transfersRequirePreparation: false }),
      );

      const after = await inject({ method: 'GET', url: '/api/v1/administration/tenant-settings', headers: readHeaders(admin) });
      expect(JSON.parse(after.body)).toEqual(
        expect.objectContaining({ transfersRequireApproval: false, transfersRequirePreparation: false }),
      );
    });

    it('rejects an invalid timezone (not IANA-recognized)', async () => {
      const admin = await registerTenant('Iota Tenant Co', 'admin@iota-tenant.example');
      const response = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: { timezone: 'Not/A_Real_Zone' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects businessHours with two entries for the same dayOfWeek', async () => {
      const admin = await registerTenant('Kappa Tenant Co', 'admin@kappa-tenant.example');
      const response = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: {
          businessHours: [
            { dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' },
            { dayOfWeek: 3, opensAt: '10:00', closesAt: '20:00' },
          ],
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown field in the body — mass assignment (§18/§28 scenario C)', async () => {
      const admin = await registerTenant('Lambda Tenant Co', 'admin@lambda-tenant.example');
      const response = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(admin),
        payload: { timezone: 'UTC', tenantId: 'x', createdBy: 'x' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('anonymous is rejected (401); authenticated without administration.settings.manage is rejected (403) on PATCH, and without .view on GET', async () => {
      const anonGet = await inject({ method: 'GET', url: '/api/v1/administration/tenant-settings' });
      expect(anonGet.statusCode).toBe(401);
      const anonPatch = await inject({ method: 'PATCH', url: '/api/v1/administration/tenant-settings', payload: { timezone: 'UTC' } });
      expect(anonPatch.statusCode).toBe(401);

      const admin = await registerTenant('Mu Tenant Co', 'admin@mu-tenant.example');
      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@mu-tenant.example');

      const forbiddenGet = await inject({ method: 'GET', url: '/api/v1/administration/tenant-settings', headers: readHeaders(lowPriv) });
      expect(forbiddenGet.statusCode).toBe(403);

      const forbiddenPatch = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(lowPriv),
        payload: { timezone: 'UTC' },
      });
      expect(forbiddenPatch.statusCode).toBe(403);
    });
  });

  describe('tenant isolation (§19)', () => {
    it("Tenant A's PATCH never affects Tenant B's effective configuration", async () => {
      const tenantA = await registerTenant('Nu Tenant Co', 'admin@nu-tenant.example');
      const tenantB = await registerTenant('Xi Tenant Co', 'admin@xi-tenant.example');

      const patchA = await inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: writeHeaders(tenantA),
        payload: { timezone: 'America/Bogota' },
      });
      expect(patchA.statusCode).toBe(200);

      const getB = await inject({ method: 'GET', url: '/api/v1/administration/tenant-settings', headers: readHeaders(tenantB) });
      expect(JSON.parse(getB.body)).toEqual({
        timezone: 'UTC',
        businessHours: [],
        transfersRequireApproval: true,
        transfersRequirePreparation: true,
        updatedAt: null,
      });
    });
  });
});
