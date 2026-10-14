import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * F18-02 — `GET /api/v1/reports/sales-summary` end to end against real PostgreSQL, through the
 * real `buildApp()` (no mocks): tenant isolation, `[from, to)` boundary semantics, the
 * `status='confirmed'` default, real SUM/COUNT/AVG aggregation, and day/week/month/product/customer
 * grouping. Every fixture order goes through the real cart -> checkout -> confirm flow
 * (`sales-harness.ts`) — no direct SQL insert into `orders`/`order_items`, so every fixture is
 * exactly as valid as a real sale.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: sales summary (integration, F18-02)', () => {
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

  /** A product variant with max=base=min price, so a checkout at that price is never an
   * exceptional discount (discount_amount is always exactly 0) — keeps every total trivially
   * predictable: `line_total = unitPrice * quantity`, `orders.total = orders.subtotal`. */
  async function seed(company: string, email: string, unitPrice = 100): Promise<Fixture & { unitPrice: number }> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const { variantId } = await c.createProductVariant(admin, {
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      maxPrice: unitPrice,
      basePrice: unitPrice,
      minPrice: unitPrice,
    });
    await c.receiveStock(admin, variantId, locationId, 1000);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, locationId, variantId, customerId, unitPrice };
  }

  async function addAnotherVariant(f: Fixture & { unitPrice: number }, unitPrice: number): Promise<string> {
    const { variantId } = await c.createProductVariant(f.admin, {
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      maxPrice: unitPrice,
      basePrice: unitPrice,
      minPrice: unitPrice,
    });
    await c.receiveStock(f.admin, variantId, f.locationId, 1000);
    return variantId;
  }

  async function addAnotherCustomer(f: Fixture, suffix: string): Promise<string> {
    return c.createCustomer(f.admin, c.fullCustomer(suffix));
  }

  async function createOrder(
    f: Pick<Fixture, 'admin' | 'locationId' | 'customerId'>,
    variantId: string,
    quantity: number,
    confirm: boolean,
  ): Promise<{ id: string; createdAt: string; total: number; status: string }> {
    const created = await c.inject({
      method: 'POST',
      url: '/api/v1/cart',
      headers: c.writeHeaders(f.admin),
      payload: { locationId: f.locationId, customerId: f.customerId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;

    const added = await c.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: c.writeHeaders(f.admin),
      payload: { productVariantId: variantId, quantity },
    });
    expect(added.statusCode, added.body).toBe(200);
    const subtotal = (JSON.parse(added.body) as { subtotal: number }).subtotal;

    const checkedOut = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(checkedOut.statusCode, checkedOut.body).toBe(201);
    let order = JSON.parse(checkedOut.body) as { id: string; createdAt: string; total: number; status: string };

    if (confirm) {
      const confirmed = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/confirm`,
        headers: c.writeHeaders(f.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: subtotal }] },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      order = JSON.parse(confirmed.body);
    }
    return order;
  }

  function summary(session: Session, query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return c.inject({ method: 'GET', url: `/api/v1/reports/sales-summary?${params}`, headers: c.readHeaders(session) });
  }

  const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  describe('access control', () => {
    it('requires sales.orders.view — a Bodega user (no order-view permission) is 403', async () => {
      const f = await seed('Reports Access Co', 'admin@reports-access.example');
      const bodega = await c.createAndLoginAs(f.admin, 'bodega@reports-access.example', 'Bodega');
      const res = await summary(bodega, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
      expect(res.statusCode).toBe(403);
    });

    it('an unauthenticated caller is 401', async () => {
      const res = await c.inject({ method: 'GET', url: `/api/v1/reports/sales-summary?from=${HOUR_AGO}&to=${IN_AN_HOUR}` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('query validation', () => {
    it('400 when `from` is missing', async () => {
      const f = await seed('Reports Validation Co', 'admin@reports-validation.example');
      const res = await summary(f.admin, { to: IN_AN_HOUR, groupBy: 'day' });
      expect(res.statusCode).toBe(400);
    });

    it('400 when `to` is missing', async () => {
      const f = await seed('Reports Validation Co 2', 'admin@reports-validation2.example');
      const res = await summary(f.admin, { from: HOUR_AGO, groupBy: 'day' });
      expect(res.statusCode).toBe(400);
    });

    it('400 when `from` is not strictly before `to`', async () => {
      const f = await seed('Reports Validation Co 3', 'admin@reports-validation3.example');
      const res = await summary(f.admin, { from: IN_AN_HOUR, to: HOUR_AGO, groupBy: 'day' });
      expect(res.statusCode).toBe(400);
    });

    it('400 on an invalid groupBy value — never silently ignored', async () => {
      const f = await seed('Reports Validation Co 4', 'admin@reports-validation4.example');
      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'location' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('tenant isolation', () => {
    it('tenant A never sees tenant B\'s orders in the summary', async () => {
      const a = await seed('Reports Iso A', 'admin@reports-iso-a.example');
      const b = await seed('Reports Iso B', 'admin@reports-iso-b.example');
      await createOrder(a, a.variantId, 1, true);
      await createOrder(b, b.variantId, 1, true);

      const resA = await summary(a.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
      const resB = await summary(b.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);

      const bodyA = JSON.parse(resA.body) as { buckets: { orderCount: number }[] };
      const bodyB = JSON.parse(resB.body) as { buckets: { orderCount: number }[] };
      const totalA = bodyA.buckets.reduce((n, x) => n + x.orderCount, 0);
      const totalB = bodyB.buckets.reduce((n, x) => n + x.orderCount, 0);
      expect(totalA).toBe(1);
      expect(totalB).toBe(1);
    });
  });

  describe('[from, to) boundary semantics', () => {
    it('a row exactly at `to` is excluded; the same instant as `from` is included', async () => {
      const f = await seed('Reports Boundary Co', 'admin@reports-boundary.example');
      const order = await createOrder(f, f.variantId, 1, true);
      const at = order.createdAt;
      const oneMsLater = new Date(new Date(at).getTime() + 1).toISOString();

      const excluded = await summary(f.admin, { from: HOUR_AGO, to: at, groupBy: 'day' });
      const excludedBody = JSON.parse(excluded.body) as { buckets: { orderCount: number }[] };
      expect(excludedBody.buckets.reduce((n, x) => n + x.orderCount, 0)).toBe(0);

      const includedByTo = await summary(f.admin, { from: HOUR_AGO, to: oneMsLater, groupBy: 'day' });
      const includedByToBody = JSON.parse(includedByTo.body) as { buckets: { orderCount: number }[] };
      expect(includedByToBody.buckets.reduce((n, x) => n + x.orderCount, 0)).toBe(1);

      const includedByFrom = await summary(f.admin, { from: at, to: IN_AN_HOUR, groupBy: 'day' });
      const includedByFromBody = JSON.parse(includedByFrom.body) as { buckets: { orderCount: number }[] };
      expect(includedByFromBody.buckets.reduce((n, x) => n + x.orderCount, 0)).toBe(1);
    });
  });

  describe('status default and filtering', () => {
    it('defaults to status=confirmed, excluding a pending order; status=pending flips it', async () => {
      const f = await seed('Reports Status Co', 'admin@reports-status.example');
      await createOrder(f, f.variantId, 1, false); // stays pending
      await createOrder(f, f.variantId, 1, true); // confirmed

      const defaultRes = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
      const defaultBody = JSON.parse(defaultRes.body) as { buckets: { orderCount: number }[] };
      expect(defaultBody.buckets.reduce((n, x) => n + x.orderCount, 0)).toBe(1);

      const pendingRes = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', status: 'pending' });
      const pendingBody = JSON.parse(pendingRes.body) as { buckets: { orderCount: number }[] };
      expect(pendingBody.buckets.reduce((n, x) => n + x.orderCount, 0)).toBe(1);
    });
  });

  describe('aggregation correctness', () => {
    it('orderCount/subtotal/discountTotal/total/avgTicket match the real confirmed orders exactly', async () => {
      const f = await seed('Reports Agg Co', 'admin@reports-agg.example', 100);
      await createOrder(f, f.variantId, 1, true); // total 100
      await createOrder(f, f.variantId, 2, true); // total 200

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'month' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        timezone: string;
        currency: string;
        buckets: { orderCount: number; subtotal: number; discountTotal: number; total: number; avgTicket: number }[];
      };
      expect(body.buckets).toHaveLength(1);
      const bucket = body.buckets[0]!;
      expect(bucket.orderCount).toBe(2);
      expect(bucket.subtotal).toBe(300);
      expect(bucket.discountTotal).toBe(0);
      expect(bucket.total).toBe(300);
      expect(bucket.avgTicket).toBe(150);
      expect(body.currency).toBe('USD');
      expect(body.timezone).toBe('UTC'); // no tenant_settings row written in this fixture
    });
  });

  describe('groupBy=day/week/month', () => {
    it('produces one bucket for orders created in the same run, with a real YYYY-MM-DD key per unit', async () => {
      const f = await seed('Reports Period Co', 'admin@reports-period.example');
      await createOrder(f, f.variantId, 1, true);
      await createOrder(f, f.variantId, 1, true);

      for (const groupBy of ['day', 'week', 'month'] as const) {
        const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy });
        expect(res.statusCode, res.body).toBe(200);
        const body = JSON.parse(res.body) as { buckets: { key: string; orderCount: number }[] };
        expect(body.buckets).toHaveLength(1);
        expect(body.buckets[0]!.orderCount).toBe(2);
        expect(body.buckets[0]!.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe('groupBy=product', () => {
    it('groups by variant with frozen sku/productName, never joining the live catalog', async () => {
      const f = await seed('Reports Product Co', 'admin@reports-product.example', 50);
      const otherVariantId = await addAnotherVariant(f, 75);
      await createOrder(f, f.variantId, 2, true); // 100
      await createOrder(f, otherVariantId, 1, true); // 75

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'product' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as {
        buckets: { key: string; sku: string; productName: string; orderCount: number; quantity: number; total: number }[];
      };
      expect(body.buckets).toHaveLength(2);
      const byKey = new Map(body.buckets.map((b) => [b.key, b]));
      const first = byKey.get(f.variantId)!;
      expect(first.orderCount).toBe(1);
      expect(first.quantity).toBe(2);
      expect(first.total).toBe(100);
      expect(first.sku).toBeTruthy();
      expect(first.productName).toBeTruthy();
      const second = byKey.get(otherVariantId)!;
      expect(second.quantity).toBe(1);
      expect(second.total).toBe(75);
    });
  });

  describe('groupBy=customer', () => {
    it('groups by customer with frozen customerName, never joining the live customer table', async () => {
      const f = await seed('Reports Customer Co', 'admin@reports-customer.example', 60);
      const otherCustomerId = await addAnotherCustomer(f, 'second');
      await createOrder(f, f.variantId, 1, true); // customer 1, 60
      await createOrder({ ...f, customerId: otherCustomerId }, f.variantId, 2, true); // customer 2, 120

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'customer' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as {
        buckets: { key: string; customerName: string; orderCount: number; total: number; avgTicket: number }[];
      };
      expect(body.buckets).toHaveLength(2);
      const byKey = new Map(body.buckets.map((b) => [b.key, b]));
      expect(byKey.get(f.customerId)!.total).toBe(60);
      expect(byKey.get(otherCustomerId)!.total).toBe(120);
      expect(byKey.get(otherCustomerId)!.customerName).toBeTruthy();
    });
  });
});
