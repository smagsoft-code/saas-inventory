import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';

/**
 * ROLES/PERMISSIONS block (closes `GAP-ROLE-CRUD`) — `POST/PATCH/DELETE /roles`,
 * `PUT /roles/:id/permissions`, `GET /permissions`, and ADR-0034's self-escalation block on the
 * permission-replace endpoint. Same boot/inject convention as
 * test/core/users-rbac.integration.test.ts (helper functions duplicated locally rather than
 * shared, matching that file's own convention) — skipped unless the TEST_*_DATABASE_URL env vars
 * are set; see test/database/helpers.ts. Does NOT call resetAndMigrate() itself (global-setup.ts
 * already does this once for the whole run).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('core: roles CRUD + self-escalation (integration)', () => {
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

  async function roleIdByName(admin: Session, name: string): Promise<string> {
    const response = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    expect(response.statusCode).toBe(200);
    const roles = JSON.parse(response.body) as { id: string; name: string }[];
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`Role "${name}" not found in tenant ${admin.user.tenantId}`);
    return role.id;
  }

  /** A "Vendedor" user — DEFAULT_ROLE_TEMPLATES holds none of the new `core.roles.manage`, only
   * `core.roles.read`-adjacent... actually Vendedor holds neither `core.roles.read` nor
   * `core.roles.manage` — used as the authenticated-but-unauthorized actor throughout this suite. */
  async function createAndLoginLowPrivilegeUser(admin: Session, email: string): Promise<Session> {
    const vendedorRoleId = await roleIdByName(admin, 'Vendedor');
    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: 'Low Privilege', password: 'a-very-long-password', roleId: vendedorRoleId },
    });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(email, 'a-very-long-password');
  }

  describe('GET /permissions', () => {
    it('401 anonymous; 403 without core.roles.read; 200 with it, listing known codes grouped by module', async () => {
      const admin = await registerTenant('Roles Perm Catalog Co', 'admin@roles-perm-catalog.example');

      const anon = await inject({ method: 'GET', url: '/api/v1/permissions' });
      expect(anon.statusCode).toBe(401);

      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@roles-perm-catalog.example');
      const forbidden = await inject({ method: 'GET', url: '/api/v1/permissions', headers: readHeaders(lowPriv) });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await inject({ method: 'GET', url: '/api/v1/permissions', headers: readHeaders(admin) });
      expect(allowed.statusCode).toBe(200);
      const catalog = JSON.parse(allowed.body) as { code: string; module: string; description: string }[];
      expect(catalog.length).toBeGreaterThan(20);
      expect(catalog.find((p) => p.code === 'core.roles.manage')?.module).toBe('core');
      expect(catalog.find((p) => p.code === 'sales.orders.create')?.module).toBe('sales');
    });
  });

  describe('POST /roles (create)', () => {
    it('401 anonymous, 403 without core.roles.manage, 201 with it', async () => {
      const admin = await registerTenant('Roles Create Co', 'admin@roles-create.example');

      const anon = await inject({ method: 'POST', url: '/api/v1/roles', payload: { name: 'Cajero' } });
      expect(anon.statusCode).toBe(401);

      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@roles-create.example');
      const forbidden = await inject({
        method: 'POST',
        url: '/api/v1/roles',
        headers: writeHeaders(lowPriv),
        payload: { name: 'Cajero' },
      });
      expect(forbidden.statusCode).toBe(403);

      const created = await inject({
        method: 'POST',
        url: '/api/v1/roles',
        headers: writeHeaders(admin),
        payload: { name: 'Cajero', description: 'Punto de venta', permissionCodes: ['sales.orders.view', 'sales.orders.create'] },
      });
      expect(created.statusCode).toBe(201);
      const body = JSON.parse(created.body) as { id: string; name: string; isSystemDefault: boolean; permissionCodes: string[] };
      expect(body.name).toBe('Cajero');
      expect(body.isSystemDefault).toBe(false);
      expect(body.permissionCodes.sort()).toEqual(['sales.orders.create', 'sales.orders.view']);
    });

    it('rejects an unknown permission code (400) and a duplicate role name in the same tenant (409)', async () => {
      const admin = await registerTenant('Roles Validation Co', 'admin@roles-validation.example');

      const unknownCode = await inject({
        method: 'POST',
        url: '/api/v1/roles',
        headers: writeHeaders(admin),
        payload: { name: 'Fantasma', permissionCodes: ['not.a.real.code'] },
      });
      expect(unknownCode.statusCode).toBe(400);

      const first = await inject({
        method: 'POST',
        url: '/api/v1/roles',
        headers: writeHeaders(admin),
        payload: { name: 'Duplicado' },
      });
      expect(first.statusCode).toBe(201);

      const second = await inject({
        method: 'POST',
        url: '/api/v1/roles',
        headers: writeHeaders(admin),
        payload: { name: 'Duplicado' },
      });
      expect(second.statusCode).toBe(409);
    });
  });

  describe('PATCH /roles/:id (rename/describe)', () => {
    it('works on a custom role and, deliberately, also on the caller’s own currently-assigned role (Administrador)', async () => {
      const admin = await registerTenant('Roles Rename Co', 'admin@roles-rename.example');
      const adminRoleId = await roleIdByName(admin, 'Administrador');

      const renameSelf = await inject({
        method: 'PATCH',
        url: `/api/v1/roles/${adminRoleId}`,
        headers: writeHeaders(admin),
        payload: { description: 'Renamed by its own holder' },
      });
      expect(renameSelf.statusCode).toBe(200);
      expect(JSON.parse(renameSelf.body).description).toBe('Renamed by its own holder');
    });

    it('cross-tenant role id 404s', async () => {
      const tenantA = await registerTenant('Roles Cross A Co', 'admin@roles-cross-a.example');
      const tenantB = await registerTenant('Roles Cross B Co', 'admin@roles-cross-b.example');
      const roleInB = await roleIdByName(tenantB, 'Vendedor');

      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/roles/${roleInB}`,
        headers: writeHeaders(tenantA),
        payload: { description: 'Should not apply' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /roles/:id/permissions — ADR-0034 self-escalation block', () => {
    it('allows the caller to change a permission set on ANOTHER role', async () => {
      const admin = await registerTenant('Roles Other Co', 'admin@roles-other.example');
      const vendedorRoleId = await roleIdByName(admin, 'Vendedor');

      const response = await inject({
        method: 'PUT',
        url: `/api/v1/roles/${vendedorRoleId}/permissions`,
        headers: writeHeaders(admin),
        payload: { permissionCodes: ['sales.orders.view'] },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).permissionCodes).toEqual(['sales.orders.view']);
      expect(JSON.parse(response.body).isAssignedToCaller).toBe(false);
    });

    it('rejects (403, ROLE_SELF_PERMISSION_ESCALATION) an attempt to change permissions of the caller’s own currently-assigned role, even while holding core.roles.manage', async () => {
      const admin = await registerTenant('Roles Self Co', 'admin@roles-self.example');
      const adminRoleId = await roleIdByName(admin, 'Administrador');

      const response = await inject({
        method: 'PUT',
        url: `/api/v1/roles/${adminRoleId}/permissions`,
        headers: writeHeaders(admin),
        payload: { permissionCodes: ['core.roles.manage', 'core.roles.assign', 'core.roles.read'] },
      });
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { code: string };
      expect(body.code).toBe('ROLE_SELF_PERMISSION_ESCALATION');
    });

    it('a Vendedor with no core.roles.manage cannot add permissions to any role, including their own (403, generic FORBIDDEN — the guard rejects before the service self-check even runs)', async () => {
      const admin = await registerTenant('Roles Vendedor Self Co', 'admin@roles-vendedor-self.example');
      const vendedorRoleId = await roleIdByName(admin, 'Vendedor');
      const lowPriv = await createAndLoginLowPrivilegeUser(admin, 'vendedor@roles-vendedor-self.example');

      const response = await inject({
        method: 'PUT',
        url: `/api/v1/roles/${vendedorRoleId}/permissions`,
        headers: writeHeaders(lowPriv),
        payload: { permissionCodes: ['core.roles.manage'] },
      });
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).code).toBe('FORBIDDEN');
    });

    it('rejects an unknown permission code (400) on a role the caller does not hold', async () => {
      const admin = await registerTenant('Roles Unknown Perm Co', 'admin@roles-unknown-perm.example');
      const vendedorRoleId = await roleIdByName(admin, 'Vendedor');

      const response = await inject({
        method: 'PUT',
        url: `/api/v1/roles/${vendedorRoleId}/permissions`,
        headers: writeHeaders(admin),
        payload: { permissionCodes: ['not.a.real.code'] },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /roles/:id', () => {
    it('409s while 1+ users hold the role; succeeds (204) once nobody holds it', async () => {
      const admin = await registerTenant('Roles Delete Co', 'admin@roles-delete.example');

      const created = await inject({
        method: 'POST',
        url: '/api/v1/roles',
        headers: writeHeaders(admin),
        payload: { name: 'Temporal', permissionCodes: [] },
      });
      expect(created.statusCode).toBe(201);
      const roleId = (JSON.parse(created.body) as { id: string }).id;

      await inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: writeHeaders(admin),
        payload: { email: 'holder@roles-delete.example', fullName: 'Holder', password: 'a-very-long-password', roleId },
      });

      const blocked = await inject({ method: 'DELETE', url: `/api/v1/roles/${roleId}`, headers: writeHeaders(admin) });
      expect(blocked.statusCode).toBe(409);

      const unusedCreated = await inject({
        method: 'POST',
        url: '/api/v1/roles',
        headers: writeHeaders(admin),
        payload: { name: 'Nunca Asignado', permissionCodes: [] },
      });
      const unusedRoleId = (JSON.parse(unusedCreated.body) as { id: string }).id;
      const deleted = await inject({ method: 'DELETE', url: `/api/v1/roles/${unusedRoleId}`, headers: writeHeaders(admin) });
      expect(deleted.statusCode).toBe(204);

      const afterDelete = await inject({ method: 'GET', url: `/api/v1/roles/${unusedRoleId}`, headers: readHeaders(admin) });
      expect(afterDelete.statusCode).toBe(404);
    });

    it('predefined roles (is_system_default) are deletable exactly like custom ones once unused — no extra protection invented', async () => {
      const admin = await registerTenant('Roles Predefined Delete Co', 'admin@roles-predefined-delete.example');
      // Bodega ships with nobody assigned at registration time (only the founding admin exists,
      // holding Administrador) — deletable immediately, same as a fresh custom role.
      const bodegaRoleId = await roleIdByName(admin, 'Bodega');

      const deleted = await inject({ method: 'DELETE', url: `/api/v1/roles/${bodegaRoleId}`, headers: writeHeaders(admin) });
      expect(deleted.statusCode).toBe(204);
    });
  });

  describe('ADR-0031 regression — role ASSIGNMENT self-escalation still blocked', () => {
    it('a user still cannot change their own role via PATCH /users/:id after the ROLES/PERMISSIONS block landed', async () => {
      const admin = await registerTenant('Roles Adr0031 Regression Co', 'admin@roles-adr0031-regression.example');
      const adminRoleId = await roleIdByName(admin, 'Administrador');

      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/users/${admin.user.id}`,
        headers: writeHeaders(admin),
        payload: { roleId: adminRoleId },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
