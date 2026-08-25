import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl } from '../database/helpers';

/**
 * FASE 8 (roadmap.md) — inventory_transfers full lifecycle (database.md#inventory-transfers-and-in-transit-stock,
 * ADR-0020), exercised through the real guard chain and a real PostgreSQL instance. Same boot/inject
 * convention as test/inventory/inventory.integration.test.ts (FASE 7) and
 * inventory-stock.integration.test.ts (this phase's balances/movements/adjustments file).
 *
 * Does NOT call resetAndMigrate() itself — global-setup.ts already resets/migrates exactly once for
 * the whole test:integration run.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('inventory: transfers (integration)', () => {
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

  function writeHeaders(session: Session, extra: Record<string, string> = {}): Record<string, string> {
    return {
      cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
      ...extra,
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

  async function loginAs(tenantSlug: string, email: string, password: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantSlug, email, password } });
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

  async function createAndLoginAs(admin: Session, email: string, roleName: string): Promise<Session> {
    const roleId = await roleIdByName(admin, roleName);
    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: `${roleName} User`, password: 'a-very-long-password', roleId },
    });
    expect(createResponse.statusCode).toBe(201);
    return loginAs(admin.user.tenantSlug, email, 'a-very-long-password');
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

  async function adjust(session: Session, payload: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return inject({ method: 'POST', url: '/api/v1/inventory/adjustments', headers: writeHeaders(session), payload });
  }

  /** Two locations in one warehouse, one product variant with `initialStock` physically receipted
   * at the source location — the fixture every transfer test starts from. */
  async function seedTenant(companyName: string, email: string, initialStock = 100) {
    const admin = await registerTenant(companyName, email);
    const warehouseId = await createWarehouse(admin, `${companyName} WH`, `WH-${Date.now()}`);
    const sourceLocationId = await createLocation(admin, warehouseId, 'Source', `SRC-${Date.now()}`);
    const destinationLocationId = await createLocation(admin, warehouseId, 'Destination', `DST-${Date.now()}`);
    const productVariantId = await createProductVariant(admin, `${companyName} Product`, `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const receipt = await adjust(admin, { productVariantId, locationId: sourceLocationId, movementType: 'RECEIPT', quantity: initialStock, reason: 'Seed' });
    expect(receipt.statusCode).toBe(201);
    return { admin, warehouseId, sourceLocationId, destinationLocationId, productVariantId };
  }

  async function createTransfer(session: Session, sourceLocationId: string, destinationLocationId: string, productVariantId: string, quantityRequested: number): Promise<string> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: writeHeaders(session),
      payload: { sourceLocationId, destinationLocationId, items: [{ productVariantId, quantityRequested }] },
    });
    expect(response.statusCode).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function getTransfer(session: Session, id: string): Promise<{ id: string; status: string; items: { id: string; quantityRequested: number; quantityDispatched: number; quantityReceived: number; quantityInTransit: number }[] }> {
    const response = await inject({ method: 'GET', url: `/api/v1/inventory/transfers/${id}`, headers: readHeaders(session) });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
  }

  async function balanceOf(session: Session, productVariantId: string, locationId: string): Promise<{ quantityPhysical: number; quantityReserved: number; quantityAvailable: number } | undefined> {
    const response = await inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${productVariantId}&locationId=${locationId}`, headers: readHeaders(session) });
    expect(response.statusCode).toBe(200);
    return (JSON.parse(response.body) as { data: { quantityPhysical: number; quantityReserved: number; quantityAvailable: number }[] }).data[0];
  }

  describe('full lifecycle (§17-§19, ADR-0020)', () => {
    it('draft -> approved -> preparing -> dispatched -> received, with correct balance/reservation/in-transit effects at each step', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Alpha Co', 'admin@transfer-alpha.example', 100);
      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 30);

      let transfer = await getTransfer(admin, transferId);
      expect(transfer.status).toBe('draft');
      let source = await balanceOf(admin, productVariantId, sourceLocationId);
      expect(source?.quantityReserved).toBe(0);

      const approve = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      expect(approve.statusCode).toBe(200);
      expect(JSON.parse(approve.body).status).toBe('approved');

      const prepare = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      expect(prepare.statusCode).toBe(200);
      expect(JSON.parse(prepare.body).status).toBe('preparing');
      source = await balanceOf(admin, productVariantId, sourceLocationId);
      expect(source).toEqual(expect.objectContaining({ quantityPhysical: 100, quantityReserved: 30, quantityAvailable: 70 }));

      const dispatch = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      expect(dispatch.statusCode).toBe(200);
      expect(JSON.parse(dispatch.body).status).toBe('dispatched');
      source = await balanceOf(admin, productVariantId, sourceLocationId);
      // reservation released, physical decremented — 70 available at source, nothing reserved anymore.
      expect(source).toEqual(expect.objectContaining({ quantityPhysical: 70, quantityReserved: 0, quantityAvailable: 70 }));
      let destination = await balanceOf(admin, productVariantId, destinationLocationId);
      expect(destination).toBeUndefined(); // nothing physically arrived yet — in-transit, not a stored bucket.

      transfer = await getTransfer(admin, transferId);
      expect(transfer.items[0]).toEqual(expect.objectContaining({ quantityDispatched: 30, quantityReceived: 0, quantityInTransit: 30 }));

      const receive = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/receive`,
        headers: writeHeaders(admin, { 'idempotency-key': `receive-${transferId}-full` }),
        payload: { items: [{ transferItemId: transfer.items[0]!.id, quantityReceived: 30 }] },
      });
      expect(receive.statusCode).toBe(200);
      expect(JSON.parse(receive.body).status).toBe('received');

      destination = await balanceOf(admin, productVariantId, destinationLocationId);
      expect(destination).toEqual(expect.objectContaining({ quantityPhysical: 30, quantityReserved: 0, quantityAvailable: 30 }));

      transfer = await getTransfer(admin, transferId);
      expect(transfer.items[0]).toEqual(expect.objectContaining({ quantityDispatched: 30, quantityReceived: 30, quantityInTransit: 0 }));
    });

    it('short-shipped dispatch releases the full reservation but only decrements physical by what actually shipped', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Beta Co', 'admin@transfer-beta.example', 100);
      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 50);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      const before = await getTransfer(admin, transferId);

      const dispatch = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/dispatch`,
        headers: writeHeaders(admin),
        payload: { items: [{ transferItemId: before.items[0]!.id, quantityDispatched: 35 }] },
      });
      expect(dispatch.statusCode).toBe(200);

      const source = await balanceOf(admin, productVariantId, sourceLocationId);
      // 100 - 35 dispatched = 65 physical; reservation (50) fully released regardless of shortfall.
      expect(source).toEqual(expect.objectContaining({ quantityPhysical: 65, quantityReserved: 0, quantityAvailable: 65 }));

      const after = await getTransfer(admin, transferId);
      expect(after.items[0]).toEqual(expect.objectContaining({ quantityRequested: 50, quantityDispatched: 35 }));
    });

    it('partial receipt across two receiving events keeps the transfer partially_received, then received', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Gamma Co', 'admin@transfer-gamma.example', 100);
      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 20);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      const dispatched = await getTransfer(admin, transferId);
      const itemId = dispatched.items[0]!.id;

      const firstReceive = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/receive`,
        headers: writeHeaders(admin, { 'idempotency-key': `receive-${transferId}-1` }),
        payload: { items: [{ transferItemId: itemId, quantityReceived: 12 }] },
      });
      expect(firstReceive.statusCode).toBe(200);
      expect(JSON.parse(firstReceive.body).status).toBe('partially_received');

      const secondReceive = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/receive`,
        headers: writeHeaders(admin, { 'idempotency-key': `receive-${transferId}-2` }),
        payload: { items: [{ transferItemId: itemId, quantityReceived: 8 }] },
      });
      expect(secondReceive.statusCode).toBe(200);
      expect(JSON.parse(secondReceive.body).status).toBe('received');

      const destination = await balanceOf(admin, productVariantId, destinationLocationId);
      expect(destination?.quantityPhysical).toBe(20);
    });

    it('rejects receiving more than remains undelivered (400)', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Delta Co', 'admin@transfer-delta.example', 100);
      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 10);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      const dispatched = await getTransfer(admin, transferId);

      const overReceive = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/receive`,
        headers: writeHeaders(admin, { 'idempotency-key': `receive-${transferId}-over` }),
        payload: { items: [{ transferItemId: dispatched.items[0]!.id, quantityReceived: 999 }] },
      });
      expect(overReceive.statusCode).toBe(400);
    });

    it('cancel from draft/approved has no inventory effect; cancel from preparing releases the reservation; cancel is rejected once dispatched', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Epsilon Co', 'admin@transfer-epsilon.example', 100);

      const draftId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 5);
      const cancelDraft = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${draftId}/cancel`, headers: writeHeaders(admin) });
      expect(cancelDraft.statusCode).toBe(200);
      expect(JSON.parse(cancelDraft.body).status).toBe('cancelled');

      const preparingId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 15);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${preparingId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${preparingId}/prepare`, headers: writeHeaders(admin) });
      let source = await balanceOf(admin, productVariantId, sourceLocationId);
      expect(source?.quantityReserved).toBe(15);

      const cancelPreparing = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${preparingId}/cancel`, headers: writeHeaders(admin) });
      expect(cancelPreparing.statusCode).toBe(200);
      source = await balanceOf(admin, productVariantId, sourceLocationId);
      expect(source?.quantityReserved).toBe(0);
      expect(source?.quantityPhysical).toBe(100); // never left the source — nothing was dispatched.

      const dispatchedId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 5);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${dispatchedId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${dispatchedId}/prepare`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${dispatchedId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      const cancelDispatched = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${dispatchedId}/cancel`, headers: writeHeaders(admin) });
      expect(cancelDispatched.statusCode).toBe(409);
    });
  });

  describe('idempotency (§20, §34, database.md#idempotency)', () => {
    it('requires an Idempotency-Key header to receive (400)', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Zeta Co', 'admin@transfer-zeta.example', 100);
      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 10);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      const dispatched = await getTransfer(admin, transferId);

      const response = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/receive`,
        headers: writeHeaders(admin),
        payload: { items: [{ transferItemId: dispatched.items[0]!.id, quantityReceived: 10 }] },
      });
      expect(response.statusCode).toBe(400);
    });

    it('a sequential retry with the same Idempotency-Key and body returns the cached result without double-counting', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Eta Co', 'admin@transfer-eta.example', 100);
      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 10);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      const dispatched = await getTransfer(admin, transferId);
      const payload = { items: [{ transferItemId: dispatched.items[0]!.id, quantityReceived: 10 }] };
      const headers = writeHeaders(admin, { 'idempotency-key': 'fixed-retry-key' });

      const first = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/receive`, headers, payload });
      expect(first.statusCode).toBe(200);
      const second = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/receive`, headers, payload });
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body));

      const destination = await balanceOf(admin, productVariantId, destinationLocationId);
      expect(destination?.quantityPhysical).toBe(10); // not 20 — the retry never re-applied the movement.
    });
  });

  describe('location-scoped authorization (§14, ADR-0024)', () => {
    it('dispatch requires authorization on the source location; receive requires authorization on the destination location', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Theta Co', 'admin@transfer-theta.example', 100);
      const bodega = await createAndLoginAs(admin, 'bodega@transfer-theta.example', 'Bodega');
      // Restrict Bodega to a location that is NEITHER the source nor the destination of this transfer.
      const unrelatedWarehouse = await createWarehouse(admin, 'Unrelated WH', `UWH-${Date.now()}`);
      const unrelatedLocation = await createLocation(admin, unrelatedWarehouse, 'Unrelated', `UNR-${Date.now()}`);
      await inject({ method: 'PUT', url: `/api/v1/users/${bodega.user.id}/locations`, headers: writeHeaders(admin), payload: { locationIds: [unrelatedLocation] } });

      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 10);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });

      const prepareForbidden = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(bodega) });
      expect(prepareForbidden.statusCode).toBe(403);

      // Admin (unrestricted) prepares/dispatches so we can test receive's own location check independently.
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      const dispatched = await getTransfer(admin, transferId);

      const receiveForbidden = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/receive`,
        headers: writeHeaders(bodega, { 'idempotency-key': 'forbidden-attempt' }),
        payload: { items: [{ transferItemId: dispatched.items[0]!.id, quantityReceived: 10 }] },
      });
      expect(receiveForbidden.statusCode).toBe(403);
    });
  });

  describe('security: mass assignment, RBAC, cross-tenant (§15, §23, §37)', () => {
    it('rejects tenantId/status/requestedBy in the create body (400, mass assignment)', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Iota Co', 'admin@transfer-iota.example', 100);
      const response = await inject({
        method: 'POST',
        url: '/api/v1/inventory/transfers',
        headers: writeHeaders(admin),
        payload: { sourceLocationId, destinationLocationId, items: [{ productVariantId, quantityRequested: 1 }], status: 'received', tenantId: 'x' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('401 anonymous, 403 without inventory.transfers.request, 201 with it (RBAC matrix)', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Kappa Co', 'admin@transfer-kappa.example', 100);
      const vendedor = await createAndLoginAs(admin, 'vendedor@transfer-kappa.example', 'Vendedor');

      const anon = await inject({ method: 'GET', url: '/api/v1/inventory/transfers' });
      expect(anon.statusCode).toBe(401);

      const createForbidden = await inject({
        method: 'POST',
        url: '/api/v1/inventory/transfers',
        headers: writeHeaders(vendedor),
        payload: { sourceLocationId, destinationLocationId, items: [{ productVariantId, quantityRequested: 1 }] },
      });
      expect(createForbidden.statusCode).toBe(403);

      const bodega = await createAndLoginAs(admin, 'bodega@transfer-kappa.example', 'Bodega');
      const createAllowed = await inject({
        method: 'POST',
        url: '/api/v1/inventory/transfers',
        headers: writeHeaders(bodega),
        payload: { sourceLocationId, destinationLocationId, items: [{ productVariantId, quantityRequested: 1 }] },
      });
      expect(createAllowed.statusCode).toBe(201);

      // Bodega has request/dispatch/receive but not approve, per DEFAULT_ROLE_TEMPLATES.
      const transferId = (JSON.parse(createAllowed.body) as { id: string }).id;
      const approveForbidden = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(bodega) });
      expect(approveForbidden.statusCode).toBe(403);
    });

    it('tenant A cannot read/approve/dispatch/receive tenant B transfers, or create a transfer using tenant B locations', async () => {
      const tenantA = await seedTenant('Transfer Sigma Co', 'admin@transfer-sigma.example', 100);
      const tenantB = await seedTenant('Transfer Tau Co', 'admin@transfer-tau.example', 100);
      const transferB = await createTransfer(tenantB.admin, tenantB.sourceLocationId, tenantB.destinationLocationId, tenantB.productVariantId, 10);

      const readCrossTenant = await inject({ method: 'GET', url: `/api/v1/inventory/transfers/${transferB}`, headers: readHeaders(tenantA.admin) });
      expect(readCrossTenant.statusCode).toBe(404);

      const approveCrossTenant = await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferB}/approve`, headers: writeHeaders(tenantA.admin) });
      expect(approveCrossTenant.statusCode).toBe(404);

      const createWithForeignLocation = await inject({
        method: 'POST',
        url: '/api/v1/inventory/transfers',
        headers: writeHeaders(tenantA.admin),
        payload: { sourceLocationId: tenantB.sourceLocationId, destinationLocationId: tenantA.destinationLocationId, items: [{ productVariantId: tenantA.productVariantId, quantityRequested: 1 }] },
      });
      expect(createWithForeignLocation.statusCode).toBe(404);
    });
  });

  describe('concurrency and atomicity (§19, §35 Case C, §36 — real PostgreSQL, not mocks)', () => {
    it('Case C: two concurrent receive requests for the same outstanding quantity — exactly one effective application, never double-counted', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Mu Co', 'admin@transfer-mu.example', 100);
      const transferId = await createTransfer(admin, sourceLocationId, destinationLocationId, productVariantId, 10);
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/dispatch`, headers: writeHeaders(admin), payload: {} });
      const dispatched = await getTransfer(admin, transferId);
      const itemId = dispatched.items[0]!.id;

      const [first, second] = await Promise.all([
        inject({
          method: 'POST',
          url: `/api/v1/inventory/transfers/${transferId}/receive`,
          headers: writeHeaders(admin, { 'idempotency-key': 'concurrent-receive-A' }),
          payload: { items: [{ transferItemId: itemId, quantityReceived: 10 }] },
        }),
        inject({
          method: 'POST',
          url: `/api/v1/inventory/transfers/${transferId}/receive`,
          headers: writeHeaders(admin, { 'idempotency-key': 'concurrent-receive-B' }),
          payload: { items: [{ transferItemId: itemId, quantityReceived: 10 }] },
        }),
      ]);

      const succeeded = [first, second].filter((r) => r.statusCode === 200);
      expect(succeeded).toHaveLength(1);

      const destination = await balanceOf(admin, productVariantId, destinationLocationId);
      expect(destination?.quantityPhysical).toBe(10); // never 20 — the loser never applied.

      const finalTransfer = await getTransfer(admin, transferId);
      expect(finalTransfer.items[0]!.quantityReceived).toBe(10);
      expect(finalTransfer.status).toBe('received');
    });

    it('a dispatch rejected mid-way (one item overshoots quantityRequested) rolls back completely — no partial movements, status unchanged', async () => {
      const { admin, sourceLocationId, destinationLocationId, productVariantId } = await seedTenant('Transfer Nu Co', 'admin@transfer-nu.example', 100);
      const secondVariantId = await createProductVariant(admin, 'Transfer Nu Second Product', `SKU-2-${Date.now()}`);
      await adjust(admin, { productVariantId: secondVariantId, locationId: sourceLocationId, movementType: 'RECEIPT', quantity: 100, reason: 'Seed second variant' });

      const createResponse = await inject({
        method: 'POST',
        url: '/api/v1/inventory/transfers',
        headers: writeHeaders(admin),
        payload: {
          sourceLocationId,
          destinationLocationId,
          items: [
            { productVariantId, quantityRequested: 10 },
            { productVariantId: secondVariantId, quantityRequested: 10 },
          ],
        },
      });
      expect(createResponse.statusCode).toBe(201);
      const transferId = (JSON.parse(createResponse.body) as { id: string }).id;
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/approve`, headers: writeHeaders(admin) });
      await inject({ method: 'POST', url: `/api/v1/inventory/transfers/${transferId}/prepare`, headers: writeHeaders(admin) });
      const prepared = await getTransfer(admin, transferId);
      const validItem = prepared.items.find((i) => i.quantityRequested === 10)!;

      // Dispatch the first item validly, but ask for an impossible quantity on the second — the
      // whole request must roll back, including the first item's already-attempted movements.
      const dispatch = await inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/dispatch`,
        headers: writeHeaders(admin),
        payload: {
          items: [
            { transferItemId: prepared.items[0]!.id, quantityDispatched: 10 },
            { transferItemId: prepared.items[1]!.id, quantityDispatched: 9999 },
          ],
        },
      });
      expect(dispatch.statusCode).toBe(400);

      const afterFailure = await getTransfer(admin, transferId);
      expect(afterFailure.status).toBe('preparing'); // never advanced to dispatched.

      const source = await balanceOf(admin, productVariantId, sourceLocationId);
      // The reservation from `prepare` is untouched — the failed dispatch never committed anything.
      expect(source).toEqual(expect.objectContaining({ quantityPhysical: 100, quantityReserved: validItem.quantityRequested }));
    });
  });
});
