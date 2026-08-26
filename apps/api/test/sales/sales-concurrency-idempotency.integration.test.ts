import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { generateId } from '@saas-inventory/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * FASE 12 (SALES) — the properties that only a real PostgreSQL instance can prove (§44, §60-§61,
 * §90, §109-§112, §116-§117): concurrent checkout for the last unit, idempotent order creation
 * (HTTP retry + concurrent same-key + payload mismatch), and the tenant-suspension /
 * user-deactivation regressions from 011-A/011-B applied to SALES routes.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: concurrency + idempotency (integration)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  interface Fixture {
    admin: Session;
    locationId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string, stock: number): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    await c.receiveStock(admin, variantId, locationId, stock);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, locationId, variantId, customerId };
  }

  async function openCart(f: Fixture, session: Session, quantity: number): Promise<string> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(session), payload: { locationId: f.locationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(session), payload: { productVariantId: f.variantId, quantity } });
    expect(added.statusCode, added.body).toBe(200);
    return cartId;
  }

  function checkout(session: Session, cartId: string, key: string, documentType: 'invoice' | 'sales_note' = 'sales_note') {
    return c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(session, { 'idempotency-key': key }),
      payload: { cartId, documentType },
    });
  }

  async function balance(session: Session, variantId: string) {
    const response = await c.inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: c.readHeaders(session) });
    const row = (JSON.parse(response.body) as { data: { quantityPhysical: number; quantityReserved: number; quantityAvailable: number }[] }).data[0];
    return row ?? { quantityPhysical: 0, quantityReserved: 0, quantityAvailable: 0 };
  }

  async function countOrders(session: Session): Promise<number> {
    const response = await c.inject({ method: 'GET', url: '/api/v1/orders?pageSize=100', headers: c.readHeaders(session) });
    return (JSON.parse(response.body) as { data: unknown[] }).data.length;
  }

  describe('stock race — no oversell (§44, §90, §111)', () => {
    it('stock = 1, two concurrent checkouts for qty 1 — exactly one 201, one 409, stock never negative', async () => {
      const f = await seed('Race Stock Co', 'admin@race-stock.example', 1);
      // two separate open carts is not allowed for one user, so use two vendors.
      const vendorA = await c.createAndLoginAs(f.admin, 'a@race-stock.example', 'Vendedor');
      const vendorB = await c.createAndLoginAs(f.admin, 'b@race-stock.example', 'Vendedor');
      // both vendors need the customer/location — same tenant, they can read them.
      const cartA = await openCart(f, vendorA, 1);
      const cartB = await openCart(f, vendorB, 1);

      const [ra, rb] = await Promise.all([checkout(vendorA, cartA, randomUUID()), checkout(vendorB, cartB, randomUUID())]);
      const statuses = [ra.statusCode, rb.statusCode].sort();
      expect(statuses).toEqual([201, 409]);

      const bal = await balance(f.admin, f.variantId);
      expect(bal.quantityPhysical).toBe(1);
      expect(bal.quantityReserved).toBe(1);
      expect(bal.quantityAvailable).toBe(0);
      expect(bal.quantityAvailable).toBeGreaterThanOrEqual(0);
      expect(await countOrders(f.admin)).toBe(1);
    });
  });

  describe('idempotent order creation (§57-§61, §109-§112)', () => {
    it('HTTP retry: same key + same body -> one order, one reservation, identical result (§60)', async () => {
      const f = await seed('Idem Retry Co', 'admin@idem-retry.example', 20);
      const cartId = await openCart(f, f.admin, 4);
      const key = randomUUID();

      const first = await checkout(f.admin, cartId, key);
      expect(first.statusCode).toBe(201);
      const second = await checkout(f.admin, cartId, key);
      expect(second.statusCode).toBe(201);

      const a = JSON.parse(first.body) as { id: string; orderNumber: string };
      const b = JSON.parse(second.body) as { id: string; orderNumber: string };
      expect(b.id).toBe(a.id);
      expect(b.orderNumber).toBe(a.orderNumber);
      expect(await countOrders(f.admin)).toBe(1);
      expect((await balance(f.admin, f.variantId)).quantityReserved).toBe(4);
    });

    it('concurrent retry: two simultaneous requests with the same key -> exactly one logical order (§61, §112)', async () => {
      const f = await seed('Idem Race Co', 'admin@idem-race.example', 20);
      const cartId = await openCart(f, f.admin, 2);
      const key = randomUUID();

      const [r1, r2] = await Promise.all([checkout(f.admin, cartId, key), checkout(f.admin, cartId, key)]);
      expect([r1.statusCode, r2.statusCode].every((s) => s === 201)).toBe(true);
      const id1 = (JSON.parse(r1.body) as { id: string }).id;
      const id2 = (JSON.parse(r2.body) as { id: string }).id;
      expect(id1).toBe(id2);
      expect(await countOrders(f.admin)).toBe(1);
      expect((await balance(f.admin, f.variantId)).quantityReserved).toBe(2);
    });

    it('payload mismatch: same key, different body -> 409, no second sale (§59, §110)', async () => {
      const f = await seed('Idem Mismatch Co', 'admin@idem-mismatch.example', 20);
      const cartId = await openCart(f, f.admin, 2);
      const key = randomUUID();

      const first = await checkout(f.admin, cartId, key, 'sales_note');
      expect(first.statusCode).toBe(201);
      const mismatch = await checkout(f.admin, cartId, key, 'invoice');
      expect(mismatch.statusCode).toBe(409);
      expect(await countOrders(f.admin)).toBe(1);
    });

    it('POST /orders without an Idempotency-Key is rejected (400, §57)', async () => {
      const f = await seed('Idem Missing Co', 'admin@idem-missing.example', 5);
      const cartId = await openCart(f, f.admin, 1);
      const response = await c.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: c.writeHeaders(f.admin),
        payload: { cartId, documentType: 'sales_note' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('tenant suspension / user deactivation regressions (011-A / 011-B, §116-§117)', () => {
    it('a suspended tenant cannot reach SALES routes even with a still-valid access token', async () => {
      const f = await seed('Suspend Co', 'admin@suspend.example', 5);

      const platform = await loginPlatformAdmin();
      const suspend = await c.inject({
        method: 'POST',
        url: `/api/v1/platform/tenants/${f.admin.user.tenantId}/suspend`,
        headers: { cookie: `platform_access_token=${platform.accessToken}; platform_csrf_token=${platform.csrfToken}`, 'x-csrf-token': platform.csrfToken },
      });
      expect(suspend.statusCode, suspend.body).toBe(200);

      const blocked = await c.inject({ method: 'GET', url: '/api/v1/customers', headers: c.readHeaders(f.admin) });
      expect(blocked.statusCode).toBe(403);
      const blockedCheckout = await c.inject({
        method: 'POST',
        url: '/api/v1/cart',
        headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
        payload: { locationId: f.locationId },
      });
      expect(blockedCheckout.statusCode).toBe(403);

      // reactivate so the shared instance is left clean
      await c.inject({
        method: 'POST',
        url: `/api/v1/platform/tenants/${f.admin.user.tenantId}/activate`,
        headers: { cookie: `platform_access_token=${platform.accessToken}; platform_csrf_token=${platform.csrfToken}`, 'x-csrf-token': platform.csrfToken },
      });
    });

    it('a disabled user cannot reach SALES routes with a pre-existing token', async () => {
      const f = await seed('Disable Co', 'admin@disable.example', 5);
      const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@disable.example', 'Vendedor');

      const disable = await c.inject({
        method: 'PATCH',
        url: `/api/v1/users/${vendedor.user.id}`,
        headers: c.writeHeaders(f.admin),
        payload: { status: 'disabled' },
      });
      expect(disable.statusCode, disable.body).toBe(200);

      const blocked = await c.inject({ method: 'GET', url: '/api/v1/customers', headers: c.readHeaders(vendedor) });
      expect(blocked.statusCode).toBe(403);
    });
  });

  async function loginPlatformAdmin(): Promise<{ accessToken: string; csrfToken: string }> {
    // The platform admin is provisioned out-of-band; seed it directly against the DB the same way
    // test/administration/tenant-suspension.integration.test.ts does.
    const email = `platform-sales-${generateId()}@example.com`;
    const passwordHash = await argon2.hash('a-very-long-password', { type: argon2.argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1 });
    const { client, db } = getMigratorDb();
    try {
      await db.insert(schema.platformAdmins).values({ id: generateId(), email, passwordHash, fullName: 'Platform Test (sales suite)' });
    } finally {
      await client.end();
    }
    const login = await c.inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email, password: 'a-very-long-password' } });
    expect(login.statusCode, login.body).toBe(200);
    return {
      accessToken: c.cookieValue(login, 'platform_access_token')!,
      csrfToken: c.cookieValue(login, 'platform_csrf_token')!,
    };
  }
});
