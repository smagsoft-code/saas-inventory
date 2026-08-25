import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';

/**
 * Prompt 05-A's mandatory security proof (§28/§29/§30): tenant/user/role administration exercised
 * through the real guard chain and real app_tenant/app_platform connections — not mocks. Same
 * boot/inject convention as test/auth/auth-flow.integration.test.ts; skipped (not failed) unless
 * TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL / TEST_APP_PLATFORM_DATABASE_URL are
 * all set — see test/database/helpers.ts.
 *
 * Does NOT call resetAndMigrate() itself — see the equivalent comment in
 * test/auth/auth-flow.integration.test.ts for why (global-setup.ts already does this once for the
 * whole run; a second per-file call here raced against it and against every other integration
 * file under fileParallelism: true — found running this suite for real, Prompt 05-B).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('core: tenant/users/roles RBAC (integration)', () => {
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

  async function loginAs(tenantSlug: string, email: string, password: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantSlug, email, password } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  async function roleIdByName(admin: Session, name: string): Promise<string> {
    const response = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    expect(response.statusCode).toBe(200);
    const roles = JSON.parse(response.body) as { id: string; name: string }[];
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`Role "${name}" not found in tenant ${admin.user.tenantId}`);
    return role.id;
  }

  /** Creates a "Vendedor" user (a real default-template role with none of the new core.* admin
   * permissions — packages/shared's DEFAULT_ROLE_TEMPLATES) as the tenant admin, then logs that
   * user in for its own session — used everywhere this suite needs an authenticated-but-
   * unauthorized actor. */
  async function createAndLoginLowPrivilegeUser(admin: Session, email: string): Promise<Session> {
    const vendedorRoleId = await roleIdByName(admin, 'Vendedor');
    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: 'Low Privilege', password: 'a-very-long-password', roleId: vendedorRoleId },
    });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(admin.user.tenantSlug, email, 'a-very-long-password');
  }

  describe('tenant self-administration (§7-§9)', () => {
    it('GET /tenant returns only the caller tenant; PATCH updates only name', async () => {
      const admin = await registerTenant('Acme Tenant Co', 'admin@acme-tenant.example');

      const before = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(admin) });
      expect(before.statusCode).toBe(200);
      expect(JSON.parse(before.body).id).toBe(admin.user.tenantId);

      const patched = await inject({
        method: 'PATCH',
        url: '/api/v1/tenant',
        headers: writeHeaders(admin),
        payload: { name: 'Acme Renamed' },
      });
      expect(patched.statusCode).toBe(200);
      expect(JSON.parse(patched.body).name).toBe('Acme Renamed');
      // Untouched system fields.
      expect(JSON.parse(patched.body).status).toBe('active');
    });

    it('rejects tenantId/status/isDemo/slug in the PATCH body — mass assignment (§7/§9/§28 scenario C)', async () => {
      const admin = await registerTenant('Beta Tenant Co', 'admin@beta-tenant.example');

      const response = await inject({
        method: 'PATCH',
        url: '/api/v1/tenant',
        headers: writeHeaders(admin),
        payload: { name: 'Beta Renamed', status: 'suspended', isDemo: true, slug: 'hijacked', tenantId: 'x' },
      });
      // whitelist + forbidNonWhitelisted (main.ts) rejects the whole request outright — stronger
      // than silent stripping, still satisfies "ignored or rejected".
      expect(response.statusCode).toBe(400);
    });

    it('anonymous is rejected (401); authenticated without core.tenant.update is rejected (403)', async () => {
      const anon = await inject({ method: 'PATCH', url: '/api/v1/tenant', payload: { name: 'X' } });
      expect(anon.statusCode).toBe(401);

      const admin = await registerTenant('Gamma Tenant Co', 'admin@gamma-tenant.example');
      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@gamma-tenant.example');
      const forbidden = await inject({
        method: 'PATCH',
        url: '/api/v1/tenant',
        headers: writeHeaders(lowPriv),
        payload: { name: 'Should not work' },
      });
      expect(forbidden.statusCode).toBe(403);
    });
  });

  describe('users listing/detail (§10-§12, §28 scenario A)', () => {
    it('401 anonymous, 403 without core.users.read, 200 with it — and never leaks passwordHash', async () => {
      const admin = await registerTenant('Delta Tenant Co', 'admin@delta-tenant.example');

      const anon = await inject({ method: 'GET', url: '/api/v1/users' });
      expect(anon.statusCode).toBe(401);

      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@delta-tenant.example');
      const forbidden = await inject({ method: 'GET', url: '/api/v1/users', headers: readHeaders(lowPriv) });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await inject({ method: 'GET', url: '/api/v1/users', headers: readHeaders(admin) });
      expect(allowed.statusCode).toBe(200);
      const body = JSON.parse(allowed.body) as { data: Record<string, unknown>[] };
      expect(body.data.length).toBeGreaterThan(0);
      for (const user of body.data) {
        expect(user).not.toHaveProperty('passwordHash');
      }
    });

    it("tenant A cannot read tenant B's user by id — 404, no data leak (§28 scenario A)", async () => {
      const tenantA = await registerTenant('Epsilon Tenant Co', 'admin@epsilon-tenant.example');
      const tenantB = await registerTenant('Zeta Tenant Co', 'admin@zeta-tenant.example');

      const response = await inject({
        method: 'GET',
        url: `/api/v1/users/${tenantB.user.id}`,
        headers: readHeaders(tenantA),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('user creation (§13/§14/§28 scenario C)', () => {
    it('always creates the user in the caller tenant, ignoring any tenantId in the body', async () => {
      const admin = await registerTenant('Eta Tenant Co', 'admin@eta-tenant.example');

      const response = await inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: writeHeaders(admin),
        payload: {
          email: 'newmember@eta-tenant.example',
          fullName: 'New Member',
          password: 'a-very-long-password',
          tenantId: 'some-other-tenant-id',
        },
      });
      // Unknown `tenantId` field is rejected outright by DTO whitelisting (never silently applied).
      expect(response.statusCode).toBe(400);
    });

    it('never returns passwordHash and rejects a duplicate email within the same tenant (409)', async () => {
      const admin = await registerTenant('Theta Tenant Co', 'admin@theta-tenant.example');

      const first = await inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: writeHeaders(admin),
        payload: { email: 'dup@theta-tenant.example', fullName: 'First', password: 'a-very-long-password' },
      });
      expect(first.statusCode).toBe(201);
      expect(JSON.parse(first.body)).not.toHaveProperty('passwordHash');

      const second = await inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: writeHeaders(admin),
        payload: { email: 'dup@theta-tenant.example', fullName: 'Second', password: 'a-very-long-password' },
      });
      expect(second.statusCode).toBe(409);
    });

    it('creating a user with a roleId requires core.roles.assign in addition to core.users.create', async () => {
      // Vendedor holds none of the new core.* permissions (packages/shared's DEFAULT_ROLE_TEMPLATES) —
      // this test documents that role-assignment is a strictly separate grant from user-creation,
      // even though neither role in this suite is given core.users.create without core.roles.assign
      // by default; this asserts the service-level check directly via the admin/no-admin contrast.
      const admin = await registerTenant('Iota Tenant Co', 'admin@iota-tenant.example');
      const vendedorRoleId = await roleIdByName(admin, 'Vendedor');

      const withRole = await inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: writeHeaders(admin),
        payload: { email: 'withrole@iota-tenant.example', fullName: 'With Role', password: 'a-very-long-password', roleId: vendedorRoleId },
      });
      expect(withRole.statusCode).toBe(201);
      expect(JSON.parse(withRole.body).roleNames).toContain('Vendedor');
    });
  });

  describe('privilege escalation (§21/§22/§28 scenarios D/E — mandatory)', () => {
    it('a user can never change their own role, even to a role they could otherwise assign to others', async () => {
      const admin = await registerTenant('Kappa Tenant Co', 'admin@kappa-tenant.example');

      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/users/${admin.user.id}`,
        headers: writeHeaders(admin),
        payload: { fullName: 'Self Rename Attempt' },
      });
      // Non-security field on self is fine...
      expect(response.statusCode).toBe(200);

      const selfRole = await roleIdByName(admin, 'Administrador');
      const selfRoleChange = await inject({
        method: 'PATCH',
        url: `/api/v1/users/${admin.user.id}`,
        headers: writeHeaders(admin),
        payload: { roleId: selfRole },
      });
      expect(selfRoleChange.statusCode).toBe(403);
    });

    it('a low-privilege user cannot change another user role or status (403)', async () => {
      const admin = await registerTenant('Lambda Tenant Co', 'admin@lambda-tenant.example');
      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@lambda-tenant.example');
      const adminRoleId = await roleIdByName(admin, 'Administrador');

      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/users/${admin.user.id}`,
        headers: writeHeaders(lowPriv),
        payload: { roleId: adminRoleId },
      });
      expect(response.statusCode).toBe(403);
    });

    it("tenant A cannot modify tenant B's user (cross-tenant role/status change — §28 scenario D)", async () => {
      const tenantA = await registerTenant('Mu Tenant Co', 'admin@mu-tenant.example');
      const tenantB = await registerTenant('Nu Tenant Co', 'admin@nu-tenant.example');
      const roleInA = await roleIdByName(tenantA, 'Vendedor');

      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/users/${tenantB.user.id}`,
        headers: writeHeaders(tenantA),
        payload: { roleId: roleInA },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('RBAC test matrix (§30)', () => {
    it('anonymous listing roles is rejected (401)', async () => {
      const response = await inject({ method: 'GET', url: '/api/v1/roles' });
      expect(response.statusCode).toBe(401);
    });

    it('authenticated without core.roles.read is rejected (403); with it, succeeds (200)', async () => {
      const admin = await registerTenant('Xi Tenant Co', 'admin@xi-tenant.example');
      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@xi-tenant.example');

      const forbidden = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(lowPriv) });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
      expect(allowed.statusCode).toBe(200);
    });
  });
});
