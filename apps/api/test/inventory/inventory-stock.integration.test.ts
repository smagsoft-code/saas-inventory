import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl } from '../database/helpers';

/**
 * FASE 8 (roadmap.md) — inventory_balances / inventory_movements / manual adjustments, exercised
 * through the real guard chain and real app_tenant/app_platform connections against a real
 * PostgreSQL instance, not mocks. Same boot/inject convention as
 * test/inventory/inventory.integration.test.ts (FASE 7). Transfers get their own file
 * (inventory-transfers.integration.test.ts) since the lifecycle is large enough on its own.
 *
 * Does NOT call resetAndMigrate() itself — global-setup.ts already resets/migrates exactly once for
 * the whole test:integration run.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('inventory: balances/movements/adjustments (integration)', () => {
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

  /** A tenant role with NO permissions — "a user without inventory.view/adjust" now that the default
   * Vendedor template holds inventory.view. */
  async function createEmptyRole(admin: Session, name: string): Promise<void> {
    const created = await inject({ method: 'POST', url: '/api/v1/roles', headers: writeHeaders(admin), payload: { name, permissionCodes: [] } });
    expect(created.statusCode, created.body).toBe(201);
  }

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

  async function createLocation(admin: Session, warehouseId: string, name: string, code: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/locations', headers: writeHeaders(admin), payload: { warehouseId, name, code } });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function createProductVariant(admin: Session, name: string, sku: string): Promise<string> {
    const created = await inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(admin),
      payload: { name, defaultVariant: { sku, maxPrice: 100, basePrice: 90, minPrice: 80 } },
    });
    expect(created.statusCode).toBe(201);
    const productId = (JSON.parse(created.body) as { id: string }).id;
    const variants = await inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: readHeaders(admin) });
    expect(variants.statusCode).toBe(200);
    return (JSON.parse(variants.body) as { id: string }[])[0]!.id;
  }

  /** Registers a tenant, one warehouse (with its auto-created "General" location) and one extra
   * named location, plus one product variant — the fixture every test in this file starts from. */
  async function seedTenant(companyName: string, email: string) {
    const admin = await registerTenant(companyName, email);
    const warehouseId = await createWarehouse(admin, `${companyName} WH`, `WH-${Date.now()}`);
    const locationId = await createLocation(admin, warehouseId, `${companyName} Zone A`, `ZA-${Date.now()}`);
    const productVariantId = await createProductVariant(admin, `${companyName} Product`, `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    return { admin, warehouseId, locationId, productVariantId };
  }

  async function adjust(session: Session, payload: Record<string, unknown>): Promise<LightMyRequestResponse> {
    // RECEIPT now requires a unit cost (weighted-average costing, ADR-0037) — default one in
    // so each test keeps exercising what it was written for (locking, scope, isolation).
    const inbound = payload['movementType'] === 'RECEIPT';
    return inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: writeHeaders(session),
      payload: inbound && payload['unitCost'] === undefined ? { ...payload, unitCost: 10 } : payload,
    });
  }

  describe('adjustments and the ledger (§8, §9, §13)', () => {
    it('RECEIPT creates the balance row and an append-only movement; a later ADJUSTMENT_OUT decrements it', async () => {
      const { admin, locationId, productVariantId } = await seedTenant('Stock Alpha Co', 'admin@stock-alpha.example');

      const receipt = await adjust(admin, { productVariantId, locationId, movementType: 'RECEIPT', quantity: 50, reason: 'Initial delivery' });
      expect(receipt.statusCode).toBe(201);
      expect(JSON.parse(receipt.body)).toEqual(expect.objectContaining({ movementType: 'RECEIPT', quantity: 50, balanceAfter: 50 }));

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${productVariantId}`, headers: readHeaders(admin) });
      expect(balances.statusCode).toBe(200);
      const balance = (JSON.parse(balances.body) as { data: { quantityPhysical: number; quantityAvailable: number }[] }).data[0]!;
      expect(balance.quantityPhysical).toBe(50);
      expect(balance.quantityAvailable).toBe(50);

      const outbound = await adjust(admin, { productVariantId, locationId, movementType: 'ADJUSTMENT_OUT', quantity: 20, reason: 'Damaged in storage' });
      expect(outbound.statusCode).toBe(201);
      expect(JSON.parse(outbound.body).balanceAfter).toBe(30);

      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${productVariantId}`, headers: readHeaders(admin) });
      expect(movements.statusCode).toBe(200);
      const movementTypes = (JSON.parse(movements.body) as { data: { movementType: string }[] }).data.map((m) => m.movementType);
      expect(movementTypes).toEqual(expect.arrayContaining(['RECEIPT', 'ADJUSTMENT_OUT']));
    });

    it('rejects an adjustment that would drive physical stock negative (409), and leaves the balance/ledger untouched (atomicity)', async () => {
      const { admin, locationId, productVariantId } = await seedTenant('Stock Beta Co', 'admin@stock-beta.example');
      await adjust(admin, { productVariantId, locationId, movementType: 'RECEIPT', quantity: 10, reason: 'Stock' });

      const overdraft = await adjust(admin, { productVariantId, locationId, movementType: 'ADJUSTMENT_OUT', quantity: 999, reason: 'Too much' });
      expect(overdraft.statusCode).toBe(409);

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${productVariantId}`, headers: readHeaders(admin) });
      const balance = (JSON.parse(balances.body) as { data: { quantityPhysical: number }[] }).data[0]!;
      expect(balance.quantityPhysical).toBe(10);

      const movements = await inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${productVariantId}`, headers: readHeaders(admin) });
      const movementTypes = (JSON.parse(movements.body) as { data: { movementType: string }[] }).data.map((m) => m.movementType);
      expect(movementTypes).toEqual(['RECEIPT']);
    });

    it('rejects tenantId/actorId/balanceAfter in the body (400, mass assignment)', async () => {
      const { admin, locationId, productVariantId } = await seedTenant('Stock Gamma Co', 'admin@stock-gamma.example');
      const response = await adjust(admin, {
        productVariantId,
        locationId,
        movementType: 'RECEIPT',
        quantity: 10,
        reason: 'X',
        tenantId: 'some-other-tenant',
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown productVariantId/locationId (404)', async () => {
      const { admin, locationId, productVariantId } = await seedTenant('Stock Delta Co', 'admin@stock-delta.example');
      const badVariant = await adjust(admin, { productVariantId: '00000000-0000-0000-0000-000000000000', locationId, movementType: 'RECEIPT', quantity: 1, reason: 'X' });
      expect(badVariant.statusCode).toBe(404);

      const badLocation = await adjust(admin, { productVariantId, locationId: '00000000-0000-0000-0000-000000000000', movementType: 'RECEIPT', quantity: 1, reason: 'X' });
      expect(badLocation.statusCode).toBe(404);
    });

    it('401 anonymous, 403 without inventory.adjust, 200 with inventory.view (RBAC matrix)', async () => {
      const { admin, locationId, productVariantId } = await seedTenant('Stock Epsilon Co', 'admin@stock-epsilon.example');
      await createEmptyRole(admin, 'Sin permisos');
      const vendedor = await createAndLoginAs(admin, 'sinpermisos@stock-epsilon.example', 'Sin permisos');

      const anon = await inject({ method: 'GET', url: '/api/v1/inventory/balances' });
      expect(anon.statusCode).toBe(401);

      // A role with no permissions has neither inventory.view nor inventory.adjust.
      const viewForbidden = await inject({ method: 'GET', url: '/api/v1/inventory/balances', headers: readHeaders(vendedor) });
      expect(viewForbidden.statusCode).toBe(403);

      const adjustForbidden = await adjust(vendedor, { productVariantId, locationId, movementType: 'RECEIPT', quantity: 1, reason: 'X' });
      expect(adjustForbidden.statusCode).toBe(403);

      const bodega = await createAndLoginAs(admin, 'bodega@stock-epsilon.example', 'Bodega');
      const viewAllowed = await inject({ method: 'GET', url: '/api/v1/inventory/balances', headers: readHeaders(bodega) });
      expect(viewAllowed.statusCode).toBe(200);

      // ADR-0035: Bodega is not the founding Administrador, so it also needs an explicit location
      // assignment — this test is about the inventory.adjust permission gate, not location scope
      // (that has its own describe block below).
      await inject({ method: 'PUT', url: `/api/v1/users/${bodega.user.id}/locations`, headers: writeHeaders(admin), payload: { locationIds: [locationId] } });
      const adjustAllowed = await adjust(bodega, { productVariantId, locationId, movementType: 'RECEIPT', quantity: 1, reason: 'X' });
      expect(adjustAllowed.statusCode).toBe(201);
    });
  });

  describe('location-scoped authorization (§14, ADR-0024, ADR-0035)', () => {
    it('a user restricted to a different location is rejected (403); assigning the right one allows it', async () => {
      const { admin, warehouseId, productVariantId } = await seedTenant('Stock Zeta Co', 'admin@stock-zeta.example');
      const locationA = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const locationB = await createLocation(admin, warehouseId, 'Zone B', `ZB-${Date.now()}`);
      const bodega = await createAndLoginAs(admin, 'bodega@stock-zeta.example', 'Bodega');

      // Restrict this Bodega user to locationA only.
      const assign = await inject({
        method: 'PUT',
        url: `/api/v1/users/${bodega.user.id}/locations`,
        headers: writeHeaders(admin),
        payload: { locationIds: [locationA] },
      });
      expect(assign.statusCode).toBe(200);

      const allowedAtA = await adjust(bodega, { productVariantId, locationId: locationA, movementType: 'RECEIPT', quantity: 5, reason: 'Count' });
      expect(allowedAtA.statusCode).toBe(201);

      const forbiddenAtB = await adjust(bodega, { productVariantId, locationId: locationB, movementType: 'RECEIPT', quantity: 5, reason: 'Count' });
      expect(forbiddenAtB.statusCode).toBe(403);
    });

    it('ADR-0035: a non-Administrador user with zero location-assignment rows is DENIED everywhere, not unrestricted', async () => {
      const { admin, warehouseId, productVariantId } = await seedTenant('Stock Zeta Prime Co', 'admin@stock-zeta-prime.example');
      const locationB = await createLocation(admin, warehouseId, 'Zone B Prime', `ZBP-${Date.now()}`);
      const unassignedBodega = await createAndLoginAs(admin, 'bodega2@stock-zeta-prime.example', 'Bodega');

      const forbidden = await adjust(unassignedBodega, { productVariantId, locationId: locationB, movementType: 'RECEIPT', quantity: 5, reason: 'Count' });
      expect(forbidden.statusCode).toBe(403);
    });

    it('ADR-0035: the tenant’s founding, system-default Administrador is always unrestricted, even with zero assignment rows', async () => {
      const { admin, warehouseId, productVariantId } = await seedTenant('Stock Zeta Second Co', 'admin@stock-zeta-second.example');
      const anotherLocation = await createLocation(admin, warehouseId, 'Zone C', `ZC-${Date.now()}`);

      // `admin` here is the tenant's founding registrant — holds the system-default Administrador
      // role and has never been given a user_location_assignments row.
      const allowed = await adjust(admin, { productVariantId, locationId: anotherLocation, movementType: 'RECEIPT', quantity: 5, reason: 'Bootstrap' });
      expect(allowed.statusCode).toBe(201);
    });
  });

  describe('multi-tenancy isolation (mandatory two-tenant check)', () => {
    it('tenant A cannot read tenant B balances/movements, or adjust using tenant B locations/variants', async () => {
      const tenantA = await seedTenant('Stock Sigma Co', 'admin@stock-sigma.example');
      const tenantB = await seedTenant('Stock Tau Co', 'admin@stock-tau.example');
      await adjust(tenantB.admin, { productVariantId: tenantB.productVariantId, locationId: tenantB.locationId, movementType: 'RECEIPT', quantity: 20, reason: 'Tau stock' });

      const balancesCrossTenant = await inject({
        method: 'GET',
        url: `/api/v1/inventory/balances?productVariantId=${tenantB.productVariantId}`,
        headers: readHeaders(tenantA.admin),
      });
      expect(balancesCrossTenant.statusCode).toBe(200);
      expect((JSON.parse(balancesCrossTenant.body) as { data: unknown[] }).data).toEqual([]);

      // Tenant A cannot adjust using tenant B's location (even though the id is syntactically valid).
      const crossLocation = await adjust(tenantA.admin, {
        productVariantId: tenantA.productVariantId,
        locationId: tenantB.locationId,
        movementType: 'RECEIPT',
        quantity: 5,
        reason: 'Hijack attempt',
      });
      expect(crossLocation.statusCode).toBe(404);

      // Tenant A cannot adjust tenant B's product variant even at its own location.
      const crossVariant = await adjust(tenantA.admin, {
        productVariantId: tenantB.productVariantId,
        locationId: tenantA.locationId,
        movementType: 'RECEIPT',
        quantity: 5,
        reason: 'Hijack attempt',
      });
      expect(crossVariant.statusCode).toBe(404);
    });
  });

  describe('concurrency (§11, §35 — real PostgreSQL locking, not mocks)', () => {
    it('Case A: two concurrent ADJUSTMENT_OUT requests for more than the available stock — exactly one succeeds, final balance is correct, never negative', async () => {
      const { admin, locationId, productVariantId } = await seedTenant('Stock Concurrency-A Co', 'admin@stock-conc-a.example');
      await adjust(admin, { productVariantId, locationId, movementType: 'RECEIPT', quantity: 100, reason: 'Initial' });

      // Two concurrent requests each try to remove 70 — only one can succeed (100 - 70 = 30 remains,
      // insufficient for the second 70).
      const [first, second] = await Promise.all([
        adjust(admin, { productVariantId, locationId, movementType: 'ADJUSTMENT_OUT', quantity: 70, reason: 'Concurrent A' }),
        adjust(admin, { productVariantId, locationId, movementType: 'ADJUSTMENT_OUT', quantity: 70, reason: 'Concurrent B' }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses).toEqual([201, 409]);

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${productVariantId}`, headers: readHeaders(admin) });
      const balance = (JSON.parse(balances.body) as { data: { quantityPhysical: number }[] }).data[0]!;
      expect(balance.quantityPhysical).toBe(30);
      expect(balance.quantityPhysical).toBeGreaterThanOrEqual(0);
    });

    it('Case B: concurrent RECEIPT and ADJUSTMENT_OUT on the same balance — no lost update', async () => {
      const { admin, locationId, productVariantId } = await seedTenant('Stock Concurrency-B Co', 'admin@stock-conc-b.example');
      await adjust(admin, { productVariantId, locationId, movementType: 'RECEIPT', quantity: 100, reason: 'Initial' });

      const [receipt, outbound] = await Promise.all([
        adjust(admin, { productVariantId, locationId, movementType: 'RECEIPT', quantity: 40, reason: 'Concurrent receipt' }),
        adjust(admin, { productVariantId, locationId, movementType: 'ADJUSTMENT_OUT', quantity: 25, reason: 'Concurrent adjustment' }),
      ]);
      expect(receipt.statusCode).toBe(201);
      expect(outbound.statusCode).toBe(201);

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${productVariantId}`, headers: readHeaders(admin) });
      const row = (JSON.parse(balances.body) as { data: { quantityPhysical: number; version: number }[] }).data[0]!;
      expect(row.quantityPhysical).toBe(100 + 40 - 25);
      expect(row.version).toBe(3); // initial RECEIPT + concurrent RECEIPT + concurrent ADJUSTMENT_OUT
    });

    it('Case D: concurrent adjustments on two independent locations do not interfere with each other', async () => {
      const { admin, warehouseId, productVariantId } = await seedTenant('Stock Concurrency-D Co', 'admin@stock-conc-d.example');
      const locationA = await createLocation(admin, warehouseId, 'Zone A', `ZA-${Date.now()}`);
      const locationB = await createLocation(admin, warehouseId, 'Zone B', `ZB-${Date.now()}`);

      const [resultA, resultB] = await Promise.all([
        adjust(admin, { productVariantId, locationId: locationA, movementType: 'RECEIPT', quantity: 15, reason: 'A' }),
        adjust(admin, { productVariantId, locationId: locationB, movementType: 'RECEIPT', quantity: 25, reason: 'B' }),
      ]);
      expect(resultA.statusCode).toBe(201);
      expect(resultB.statusCode).toBe(201);

      const balances = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${productVariantId}`, headers: readHeaders(admin) });
      const rows = (JSON.parse(balances.body) as { data: { locationId: string; quantityPhysical: number }[] }).data;
      expect(rows.find((r) => r.locationId === locationA)?.quantityPhysical).toBe(15);
      expect(rows.find((r) => r.locationId === locationB)?.quantityPhysical).toBe(25);
    });
  });
});
