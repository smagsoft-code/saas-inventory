import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orders } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * Sales history rework — business-day filter (`dateFrom`/`dateTo`, tenant timezone, whole final day
 * inclusive) on `GET /orders` AND `GET /reports/sales-summary`, the seller name + notification
 * columns on the list, and `documentType`/`customerId` on the report. Real PostgreSQL, real RLS.
 * `orders.created_at` is backdated by a direct UPDATE on the disposable pg-verify DB only (the
 * HTTP contract has no override).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: history filters (integration)', () => {
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

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function backdate(orderId: string, iso: string): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      await db.update(orders).set({ createdAt: new Date(iso) }).where(eq(orders.id, orderId));
    } finally {
      await client.end();
    }
  }

  interface Fixture {
    admin: Session;
    locationId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(email: string, timezone: string): Promise<Fixture> {
    const admin = await c.registerTenant(`HIST ${uniq()}`, email);
    // 'UTC' is the tenant default (no row yet) and is not in the validated IANA list, so only patch real zones.
    if (timezone !== 'UTC') {
      const patched = await c.inject({
        method: 'PATCH',
        url: '/api/v1/administration/tenant-settings',
        headers: c.writeHeaders(admin),
        payload: { timezone },
      });
      expect(patched.statusCode, patched.body).toBe(200);
    }
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
    // Own payloads (not the shared harness helpers): receiving stock now requires a unitCost and a
    // customer is firstName/lastName + a document-typed taxId.
    const receipt = await c.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: c.writeHeaders(admin),
      payload: { productVariantId: variantId, locationId, movementType: 'RECEIPT', quantity: 50, unitCost: 10, reason: 'Test stock' },
    });
    expect(receipt.statusCode, receipt.body).toBe(201);
    const customerId = await c.createCustomer(admin, {
      type: 'pasaporte',
      firstName: 'Cliente',
      lastName: 'Prueba',
      taxId: `PX${uniq().replace(/[^0-9A-Za-z]/g, '').slice(-12)}`,
      email: `cliente-${uniq()}@example.com`,
      phone: '+59322222222',
      address: 'Av. Siempre Viva 742, Quito',
    });
    return { admin, locationId, variantId, customerId };
  }

  async function makeOrder(
    f: Fixture,
    opts: { createdAt: string; confirm?: boolean; documentType?: 'invoice' | 'sales_note'; negotiatedUnitPrice?: number },
  ): Promise<{ id: string; total: number }> {
    const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
    const cartId = (JSON.parse(cart.body) as { id: string }).id;
    const item = await c.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: c.writeHeaders(f.admin),
      payload: { productVariantId: f.variantId, quantity: 1, ...(opts.negotiatedUnitPrice ? { negotiatedUnitPrice: opts.negotiatedUnitPrice } : {}) },
    });
    expect(item.statusCode, item.body).toBeLessThan(300);
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: opts.documentType ?? 'sales_note' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const order = JSON.parse(res.body) as { id: string; total: number };
    if (opts.confirm) {
      const confirmed = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/confirm`,
        headers: c.writeHeaders(f.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: order.total }] },
      });
      expect(confirmed.statusCode, confirmed.body).toBeLessThan(300);
    }
    await backdate(order.id, opts.createdAt);
    return order;
  }

  const listOrders = (f: Fixture, qs: string) =>
    c.inject({ method: 'GET', url: `/api/v1/orders?${qs}`, headers: c.readHeaders(f.admin) });
  const summary = (f: Fixture, qs: string) =>
    c.inject({ method: 'GET', url: `/api/v1/reports/sales-summary?groupBy=day&${qs}`, headers: c.readHeaders(f.admin) });

  it('dateFrom alone / dateFrom=dateTo return the whole tenant-local day; neighbours stay out (UTC-5)', async () => {
    const f = await seed(`hist-day-${uniq()}@ex.com`, 'America/Bogota');
    const evening = await makeOrder(f, { createdAt: '2026-10-14T01:00:00Z' }); // 13/10 20:00 local
    const noon = await makeOrder(f, { createdAt: '2026-10-13T17:00:00Z' }); // 13/10 12:00 local
    const before = await makeOrder(f, { createdAt: '2026-10-13T04:59:59Z' }); // 12/10 23:59:59 local
    const after = await makeOrder(f, { createdAt: '2026-10-14T05:00:00Z' }); // 14/10 00:00 local

    for (const qs of ['dateFrom=2026-10-13', 'dateFrom=2026-10-13&dateTo=2026-10-13']) {
      const res = await listOrders(f, qs);
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as { data: Array<{ id: string }>; meta: { total: number } };
      const ids = body.data.map((o) => o.id).sort();
      expect(ids, qs).toEqual([evening.id, noon.id].sort());
      expect(body.meta.total).toBe(2);
      expect(ids).not.toContain(before.id);
      expect(ids).not.toContain(after.id);
    }
  });

  it('a multi-day range crossing a month and a year boundary includes the whole last day', async () => {
    const f = await seed(`hist-range-${uniq()}@ex.com`, 'America/Bogota');
    const a = await makeOrder(f, { createdAt: '2026-12-31T20:00:00Z' }); // 31/12 15:00 local
    const b = await makeOrder(f, { createdAt: '2027-01-02T03:00:00Z' }); // 01/01 22:00 local
    const out = await makeOrder(f, { createdAt: '2027-01-02T05:00:00Z' }); // 02/01 00:00 local
    const res = await listOrders(f, 'dateFrom=2026-12-31&dateTo=2027-01-01');
    const ids = (JSON.parse(res.body) as { data: Array<{ id: string }> }).data.map((o) => o.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
    expect(ids).not.toContain(out.id);
  });

  it('validates the new params (400): dateTo without dateFrom, bad format, impossible date, inverted range', async () => {
    const f = await seed(`hist-400-${uniq()}@ex.com`, 'UTC');
    for (const qs of ['dateTo=2026-10-13', 'dateFrom=13/10/2026', 'dateFrom=2026-02-31', 'dateFrom=2026-10-14&dateTo=2026-10-13']) {
      const res = await listOrders(f, qs);
      expect(res.statusCode, qs).toBe(400);
    }
  });

  it('list rows carry seller name and rolled-up notification status; filters compose (status, documentType, customer)', async () => {
    const f = await seed(`hist-cols-${uniq()}@ex.com`, 'UTC');
    const pending = await makeOrder(f, { createdAt: '2026-10-13T10:00:00Z', documentType: 'sales_note' });
    const confirmed = await makeOrder(f, { createdAt: '2026-10-13T11:00:00Z', confirm: true, documentType: 'invoice' });
    const res = await listOrders(f, 'dateFrom=2026-10-13');
    const rows = (JSON.parse(res.body) as { data: Array<{ id: string; placedByName?: string; notificationStatus: string }> }).data;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(pending.id)!.placedByName).toBe('Test Admin');
    expect(byId.get(pending.id)!.notificationStatus).toBe('none'); // no domain event yet
    expect(byId.get(confirmed.id)!.notificationStatus).toBe('pending'); // sales.order.confirmed, undelivered in tests

    const onlyInvoice = JSON.parse((await listOrders(f, 'dateFrom=2026-10-13&documentType=invoice&status=confirmed')).body) as { data: Array<{ id: string }> };
    expect(onlyInvoice.data.map((o) => o.id)).toEqual([confirmed.id]);
    const otherCustomer = JSON.parse((await listOrders(f, `dateFrom=2026-10-13&customerId=${randomUUID()}`)).body) as { meta: { total: number } };
    expect(otherCustomer.meta.total).toBe(0);
  });

  it('report: same business-day filter; default confirmed only; documentType/customerId filters; cards math', async () => {
    const f = await seed(`hist-rep-${uniq()}@ex.com`, 'America/Bogota');
    // 13/10 20:00 local (= 14/10 01:00Z) confirmed invoice at the default (base) price 100 → discount 20 vs max 120;
    // and one negotiated at 110 → discount 10.
    const a = await makeOrder(f, { createdAt: '2026-10-14T01:00:00Z', confirm: true, documentType: 'invoice' });
    const b = await makeOrder(f, { createdAt: '2026-10-13T15:00:00Z', confirm: true, documentType: 'sales_note', negotiatedUnitPrice: 110 });
    await makeOrder(f, { createdAt: '2026-10-13T16:00:00Z', documentType: 'sales_note' }); // pending → excluded by default
    await makeOrder(f, { createdAt: '2026-10-14T05:30:00Z', confirm: true }); // 14/10 local → out

    const res = await summary(f, 'dateFrom=2026-10-13');
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { buckets: Array<{ orderCount: number; subtotal: number; discountTotal: number; total: number }> };
    const sum = (k: 'orderCount' | 'subtotal' | 'discountTotal' | 'total') => body.buckets.reduce((n, x) => n + x[k], 0);
    expect(sum('orderCount')).toBe(2);
    expect(sum('total')).toBe(a.total + b.total);
    expect(sum('subtotal')).toBe(100 + 110);
    expect(sum('discountTotal')).toBe(20 + 10);
    expect(sum('subtotal') + sum('discountTotal')).toBe(120 + 120); // Ventas sin descuento: both lines at max_price

    const inv = JSON.parse((await summary(f, 'dateFrom=2026-10-13&documentType=invoice')).body) as typeof body;
    expect(inv.buckets.reduce((n, x) => n + x.orderCount, 0)).toBe(1);
    const none = JSON.parse((await summary(f, `dateFrom=2026-10-13&customerId=${randomUUID()}`)).body) as typeof body;
    expect(none.buckets).toEqual([]);
    const pend = JSON.parse((await summary(f, 'dateFrom=2026-10-13&status=pending')).body) as typeof body;
    expect(pend.buckets.reduce((n, x) => n + x.orderCount, 0)).toBe(1);
  });

  it('tenant isolation: another tenant never sees these orders (list or report)', async () => {
    const f1 = await seed(`hist-iso1-${uniq()}@ex.com`, 'UTC');
    await makeOrder(f1, { createdAt: '2026-10-13T10:00:00Z', confirm: true });
    const f2 = await seed(`hist-iso2-${uniq()}@ex.com`, 'UTC');
    expect(JSON.parse((await listOrders(f2, 'dateFrom=2026-10-13')).body).meta.total).toBe(0);
    expect(JSON.parse((await summary(f2, 'dateFrom=2026-10-13')).body).buckets).toEqual([]);
  });
});
