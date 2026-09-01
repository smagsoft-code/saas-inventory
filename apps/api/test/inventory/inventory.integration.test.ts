import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';

/**
 * Prompt 07's mandatory security/functional proof (§42/§52 of the Prompt 07 brief): INVENTORY
 * (warehouses, locations, user_location_assignments — roadmap.md FASE 7 scope only; balances/
 * movements/adjustments/transfers are FASE 8, not built here) exercised through the real guard
 * chain and real app_tenant/app_platform connections — not mocks. Same boot/inject convention as
 * test/catalog/catalog.integration.test.ts.
 *
 * Does NOT call resetAndMigrate() itself — global-setup.ts already resets/migrates exactly once for
 * the whole test:integration run.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('inventory: warehouses/locations/location-assignments (integration)', () => {
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

  function inject(options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse> {
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
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function loginAs(email: string, password: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function roleIdByName(admin: Session, name: string): Promise<string> {
    const response = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    expect(response.statusCode).toBe(200);
    const roles = JSON.parse(response.body) as { id: string; name: string }[];
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`Role "${name}" not found in tenant ${admin.user.tenantId}`);
    return role.id;
  }

  /** Bodega: warehouses.view/locations.view/products.view/categories.view + transfer permissions,
   * but not warehouses.manage/locations.manage — the "authenticated but under-privileged" actor for
   * most of this suite's RBAC matrix. */
  async function createAndLoginAs(admin: Session, email: string, roleName: string): Promise<Session> {
    const roleId = await roleIdByName(admin, roleName);
    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: `${roleName} User`, password: 'a-very-long-password', roleId },
    });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(email, 'a-very-long-password');
  }

  async function createWarehouse(admin: Session, name: string, code: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/warehouses', headers: writeHeaders(admin), payload: { name, code } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  describe('warehouses (§7, §15)', () => {
    it('create/list/get/update round-trip, and cross-tenant read is 404', async () => {
      const admin = await registerTenant('Inventory Alpha Co', 'admin@inventory-alpha.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Principal', 'BP');

      const listResponse = await inject({ method: 'GET', url: '/api/v1/warehouses', headers: readHeaders(admin) });
      expect(listResponse.statusCode).toBe(200);
      expect((JSON.parse(listResponse.body) as { data: unknown[] }).data.length).toBeGreaterThan(0);

      const getResponse = await inject({ method: 'GET', url: `/api/v1/warehouses/${warehouseId}`, headers: readHeaders(admin) });
      expect(getResponse.statusCode).toBe(200);
      expect(JSON.parse(getResponse.body).code).toBe('BP');

      const patchResponse = await inject({
        method: 'PATCH',
        url: `/api/v1/warehouses/${warehouseId}`,
        headers: writeHeaders(admin),
        payload: { name: 'Bodega Central' },
      });
      expect(patchResponse.statusCode).toBe(200);
      expect(JSON.parse(patchResponse.body).name).toBe('Bodega Central');

      const otherTenant = await registerTenant('Inventory Beta Co', 'admin@inventory-beta.example');
      const crossTenant = await inject({ method: 'GET', url: `/api/v1/warehouses/${warehouseId}`, headers: readHeaders(otherTenant) });
      expect(crossTenant.statusCode).toBe(404);
    });

    it('creating a warehouse also creates its default "General" location (database.md invariant)', async () => {
      const admin = await registerTenant('Inventory Gamma Co', 'admin@inventory-gamma.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Gamma', 'BG');

      const locations = await inject({
        method: 'GET',
        url: `/api/v1/locations?warehouseId=${warehouseId}`,
        headers: readHeaders(admin),
      });
      expect(locations.statusCode).toBe(200);
      const data = (JSON.parse(locations.body) as { data: { name: string; code: string }[] }).data;
      expect(data).toHaveLength(1);
      expect(data[0]?.name).toBe('General');
      expect(data[0]?.code).toBe('GENERAL');
    });

    it('rejects a duplicate code within the same tenant (409) and tenantId in the body (400, mass assignment)', async () => {
      const admin = await registerTenant('Inventory Delta Co', 'admin@inventory-delta.example');
      await createWarehouse(admin, 'Bodega Delta', 'BD');

      const dup = await inject({ method: 'POST', url: '/api/v1/warehouses', headers: writeHeaders(admin), payload: { name: 'Bodega Delta 2', code: 'BD' } });
      expect(dup.statusCode).toBe(409);

      const massAssignment = await inject({
        method: 'POST',
        url: '/api/v1/warehouses',
        headers: writeHeaders(admin),
        payload: { name: 'Mass Assignment Attempt', code: 'MA1', tenantId: 'some-other-tenant' },
      });
      expect(massAssignment.statusCode).toBe(400);
    });

    it('401 anonymous, 403 without warehouses.manage, 200 with warehouses.view (RBAC matrix)', async () => {
      const admin = await registerTenant('Inventory Epsilon Co', 'admin@inventory-epsilon.example');
      const bodega = await createAndLoginAs(admin, 'bodega@inventory-epsilon.example', 'Bodega');

      const anon = await inject({ method: 'GET', url: '/api/v1/warehouses' });
      expect(anon.statusCode).toBe(401);

      const viewAllowed = await inject({ method: 'GET', url: '/api/v1/warehouses', headers: readHeaders(bodega) });
      expect(viewAllowed.statusCode).toBe(200);

      const manageForbidden = await inject({
        method: 'POST',
        url: '/api/v1/warehouses',
        headers: writeHeaders(bodega),
        payload: { name: 'X', code: 'X1' },
      });
      expect(manageForbidden.statusCode).toBe(403);
    });
  });

  describe('locations (§7, §15, §17)', () => {
    it('create/list/get/update round-trip under a warehouse, and cross-tenant read is 404', async () => {
      const admin = await registerTenant('Inventory Zeta Co', 'admin@inventory-zeta.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Zeta', 'BZ');

      const created = await inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: writeHeaders(admin),
        payload: { warehouseId, name: 'Zona A', code: 'ZONA-A' },
      });
      expect(created.statusCode).toBe(201);
      const locationId = (JSON.parse(created.body) as { id: string }).id;

      const getResponse = await inject({ method: 'GET', url: `/api/v1/locations/${locationId}`, headers: readHeaders(admin) });
      expect(getResponse.statusCode).toBe(200);
      expect(JSON.parse(getResponse.body).code).toBe('ZONA-A');

      const patched = await inject({
        method: 'PATCH',
        url: `/api/v1/locations/${locationId}`,
        headers: writeHeaders(admin),
        payload: { isSellable: false },
      });
      expect(patched.statusCode).toBe(200);
      expect(JSON.parse(patched.body).isSellable).toBe(false);

      const otherTenant = await registerTenant('Inventory Eta Co', 'admin@inventory-eta.example');
      const crossTenant = await inject({ method: 'GET', url: `/api/v1/locations/${locationId}`, headers: readHeaders(otherTenant) });
      expect(crossTenant.statusCode).toBe(404);
    });

    it('supports nested locations (parentLocationId) within the same warehouse', async () => {
      const admin = await registerTenant('Inventory Theta Co', 'admin@inventory-theta.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Theta', 'BT');
      const zone = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId, name: 'Zona A', code: 'ZONA-A' } });
      const zoneId = (JSON.parse(zone.body) as { id: string }).id;

      const shelf = await inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: writeHeaders(admin),
        payload: { warehouseId, parentLocationId: zoneId, name: 'Estante 1', code: 'EST-1' },
      });
      expect(shelf.statusCode).toBe(201);
      expect(JSON.parse(shelf.body).parentLocationId).toBe(zoneId);
    });

    it('rejects a parentLocationId belonging to a different warehouse (400)', async () => {
      const admin = await registerTenant('Inventory Iota Co', 'admin@inventory-iota.example');
      const warehouseA = await createWarehouse(admin, 'Bodega A', 'BA-IOTA');
      const warehouseB = await createWarehouse(admin, 'Bodega B', 'BB-IOTA');
      const locationInA = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId: warehouseA, name: 'Zona A', code: 'ZONA-A' } });
      const locationInAId = (JSON.parse(locationInA.body) as { id: string }).id;

      const response = await inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: writeHeaders(admin),
        payload: { warehouseId: warehouseB, parentLocationId: locationInAId, name: 'Zona B', code: 'ZONA-B' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a location being set as its own parent (400)', async () => {
      const admin = await registerTenant('Inventory Kappa Co', 'admin@inventory-kappa.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Kappa', 'BK');
      const created = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId, name: 'Zona A', code: 'ZONA-A' } });
      const locationId = (JSON.parse(created.body) as { id: string }).id;

      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/locations/${locationId}`,
        headers: writeHeaders(admin),
        payload: { parentLocationId: locationId },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a duplicate code within the same warehouse (409)', async () => {
      const admin = await registerTenant('Inventory Lambda Co', 'admin@inventory-lambda.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Lambda', 'BL');
      await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId, name: 'Zona A', code: 'ZONA-A' } });

      const dup = await inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: writeHeaders(admin),
        payload: { warehouseId, name: 'Zona A duplicada', code: 'ZONA-A' },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('401 anonymous, 403 without locations.manage, 200 with locations.view (RBAC matrix)', async () => {
      const admin = await registerTenant('Inventory Mu Co', 'admin@inventory-mu.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Mu', 'BM');
      const bodega = await createAndLoginAs(admin, 'bodega@inventory-mu.example', 'Bodega');

      const anon = await inject({ method: 'GET', url: '/api/v1/locations' });
      expect(anon.statusCode).toBe(401);

      const viewAllowed = await inject({ method: 'GET', url: '/api/v1/locations', headers: readHeaders(bodega) });
      expect(viewAllowed.statusCode).toBe(200);

      const manageForbidden = await inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: writeHeaders(bodega),
        payload: { warehouseId, name: 'Zona X', code: 'ZONA-X' },
      });
      expect(manageForbidden.statusCode).toBe(403);
    });
  });

  describe('user location assignments (§16, ADR-0024)', () => {
    it('replace/list round-trip, and an empty set means unrestricted (zero rows)', async () => {
      const admin = await registerTenant('Inventory Nu Co', 'admin@inventory-nu.example');
      const warehouseId = await createWarehouse(admin, 'Bodega Nu', 'BN');
      const location = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId, name: 'Zona A', code: 'ZONA-A' } });
      const locationId = (JSON.parse(location.body) as { id: string }).id;
      const bodega = await createAndLoginAs(admin, 'bodega@inventory-nu.example', 'Bodega');

      const replaced = await inject({
        method: 'PUT',
        url: `/api/v1/users/${bodega.user.id}/locations`,
        headers: writeHeaders(admin),
        payload: { locationIds: [locationId] },
      });
      expect(replaced.statusCode).toBe(200);
      expect(JSON.parse(replaced.body)).toHaveLength(1);

      const listed = await inject({ method: 'GET', url: `/api/v1/users/${bodega.user.id}/locations`, headers: readHeaders(admin) });
      expect(listed.statusCode).toBe(200);
      expect((JSON.parse(listed.body) as { locationId: string }[])[0]?.locationId).toBe(locationId);

      const cleared = await inject({
        method: 'PUT',
        url: `/api/v1/users/${bodega.user.id}/locations`,
        headers: writeHeaders(admin),
        payload: { locationIds: [] },
      });
      expect(cleared.statusCode).toBe(200);
      expect(JSON.parse(cleared.body)).toEqual([]);
    });

    it('rejects a locationId belonging to another tenant (404)', async () => {
      const admin = await registerTenant('Inventory Xi Co', 'admin@inventory-xi.example');
      const otherTenant = await registerTenant('Inventory Omicron Co', 'admin@inventory-omicron.example');
      const otherWarehouseId = await createWarehouse(otherTenant, 'Bodega Omicron', 'BO');
      const otherLocation = await inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: writeHeaders(otherTenant),
        payload: { warehouseId: otherWarehouseId, name: 'Zona Foreign', code: 'ZONA-F' },
      });
      const foreignLocationId = (JSON.parse(otherLocation.body) as { id: string }).id;
      const bodega = await createAndLoginAs(admin, 'bodega@inventory-xi.example', 'Bodega');

      const response = await inject({
        method: 'PUT',
        url: `/api/v1/users/${bodega.user.id}/locations`,
        headers: writeHeaders(admin),
        payload: { locationIds: [foreignLocationId] },
      });
      expect(response.statusCode).toBe(404);
    });

    it('401 anonymous, 403 without core.users.locations.manage (RBAC matrix)', async () => {
      const admin = await registerTenant('Inventory Pi Co', 'admin@inventory-pi.example');
      const bodega = await createAndLoginAs(admin, 'bodega@inventory-pi.example', 'Bodega');

      const anon = await inject({ method: 'GET', url: `/api/v1/users/${admin.user.id}/locations` });
      expect(anon.statusCode).toBe(401);

      const forbidden = await inject({
        method: 'PUT',
        url: `/api/v1/users/${admin.user.id}/locations`,
        headers: writeHeaders(bodega),
        payload: { locationIds: [] },
      });
      expect(forbidden.statusCode).toBe(403);
    });
  });

  describe('multi-tenancy isolation (mandatory two-tenant check)', () => {
    it('tenant A cannot list, read, update, or manipulate tenant B warehouses/locations/assignments', async () => {
      const tenantA = await registerTenant('Inventory Sigma Co', 'admin@inventory-sigma.example');
      const tenantB = await registerTenant('Inventory Tau Co', 'admin@inventory-tau.example');
      const warehouseB = await createWarehouse(tenantB, 'Bodega Tau', 'BTAU');
      const locationB = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(tenantB), payload: { warehouseId: warehouseB, name: 'Zona Tau', code: 'ZONA-TAU' } });
      const locationBId = (JSON.parse(locationB.body) as { id: string }).id;

      const readWarehouse = await inject({ method: 'GET', url: `/api/v1/warehouses/${warehouseB}`, headers: readHeaders(tenantA) });
      expect(readWarehouse.statusCode).toBe(404);

      const updateWarehouse = await inject({ method: 'PATCH', url: `/api/v1/warehouses/${warehouseB}`, headers: writeHeaders(tenantA), payload: { name: 'Hijacked' } });
      expect(updateWarehouse.statusCode).toBe(404);

      const readLocation = await inject({ method: 'GET', url: `/api/v1/locations/${locationBId}`, headers: readHeaders(tenantA) });
      expect(readLocation.statusCode).toBe(404);

      // A tenant cannot create a location against another tenant's warehouse.
      const createWithForeignWarehouse = await inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: writeHeaders(tenantA),
        payload: { warehouseId: warehouseB, name: 'Foreign Warehouse Attempt', code: 'ZONA-X' },
      });
      expect(createWithForeignWarehouse.statusCode).toBe(404);
    });
  });
});
