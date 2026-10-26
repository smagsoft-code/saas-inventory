import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceApprovals, salesReturns } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * Returns + Aprobaciones history rework — real PostgreSQL, real RLS: the per-tenant sequential
 * return code (DEV-001…), order number / product names / user names resolved by the API, the
 * business-day filter (tenant timezone) and the Almacén filter on the lists AND on the two report
 * endpoints. `created_at` / `requested_at` are backdated by a direct UPDATE on the disposable
 * pg-verify DB only (the HTTP contract has no override).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: returns + approvals history (integration)', () => {
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

  interface Fixture {
    admin: Session;
    locationA: string;
    locationB: string;
    variantId: string;
    customerId: string;
  }

  async function seed(): Promise<Fixture> {
    const admin = await c.registerTenant(`RA ${uniq()}`, `ra-${uniq()}@ex.com`);
    const patched = await c.inject({
      method: 'PATCH',
      url: '/api/v1/administration/tenant-settings',
      headers: c.writeHeaders(admin),
      payload: { timezone: 'America/Bogota' }, // UTC-5, no DST
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationA = await c.createLocation(admin, warehouseId, `A-${uniq()}`);
    const locationB = await c.createLocation(admin, warehouseId, `B-${uniq()}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
    for (const locationId of [locationA, locationB]) {
      const receipt = await c.inject({
        method: 'POST',
        url: '/api/v1/inventory/adjustments',
        headers: c.writeHeaders(admin),
        payload: { productVariantId: variantId, locationId, movementType: 'RECEIPT', quantity: 50, unitCost: 10, reason: 'Test stock' },
      });
      expect(receipt.statusCode, receipt.body).toBe(201);
    }
    const customerId = await c.createCustomer(admin, {
      type: 'pasaporte',
      firstName: 'Cliente',
      lastName: 'Prueba',
      taxId: `PX${uniq().replace(/[^0-9A-Za-z]/g, '').slice(-12)}`,
      email: `cliente-${uniq()}@example.com`,
      phone: '+59322222222',
      address: 'Av. Siempre Viva 742, Quito',
    });
    return { admin, locationA, locationB, variantId, customerId };
  }

  async function makeOrder(
    f: Fixture,
    locationId: string,
    opts: { confirm?: boolean; negotiatedUnitPrice?: number } = {},
  ): Promise<{ id: string; total: number; itemId: string }> {
    const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId, customerId: f.customerId } });
    const cartId = (JSON.parse(cart.body) as { id: string }).id;
    const item = await c.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: c.writeHeaders(f.admin),
      payload: { productVariantId: f.variantId, quantity: 2, ...(opts.negotiatedUnitPrice ? { negotiatedUnitPrice: opts.negotiatedUnitPrice } : {}) },
    });
    expect(item.statusCode, item.body).toBeLessThan(300);
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const order = JSON.parse(res.body) as { id: string; total: number; items: Array<{ id: string }> };
    if (opts.confirm) {
      const confirmed = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/confirm`,
        headers: c.writeHeaders(f.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: order.total }] },
      });
      expect(confirmed.statusCode, confirmed.body).toBeLessThan(300);
    }
    return { id: order.id, total: order.total, itemId: order.items[0]!.id };
  }

  async function makeReturn(f: Fixture, order: { id: string; itemId: string }, locationId: string, quantity = 1): Promise<{ id: string; returnNumber: string }> {
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/sales-returns',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { orderId: order.id, locationId, reason: 'Cliente devolvió el equipo', items: [{ orderItemId: order.itemId, quantity }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return JSON.parse(res.body) as { id: string; returnNumber: string };
  }

  async function backdate(table: 'return' | 'approval', id: string, iso: string): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      if (table === 'return') {
        await db.update(salesReturns).set({ createdAt: new Date(iso) }).where(eq(salesReturns.id, id));
      } else {
        await db.update(priceApprovals).set({ requestedAt: new Date(iso) }).where(eq(priceApprovals.id, id));
      }
    } finally {
      await client.end();
    }
  }

  const get = (f: Fixture, url: string) => c.inject({ method: 'GET', url, headers: c.readHeaders(f.admin) });

  it('returns: sequential DEV numbers, enriched list/detail, Almacén and business-day filters', async () => {
    const f = await seed();
    const order = await makeOrder(f, f.locationA, { confirm: true });
    const r1 = await makeReturn(f, order, f.locationA);
    const r2 = await makeReturn(f, order, f.locationB);
    expect(r1.returnNumber).toBe('DEV-001');
    expect(r2.returnNumber).toBe('DEV-002');

    // r1 today-local 20:00 (= next-day 01:00Z); r2 two days before.
    await backdate('return', r1.id, '2026-10-14T01:00:00Z');
    await backdate('return', r2.id, '2026-10-11T15:00:00Z');

    const day = JSON.parse((await get(f, '/api/v1/sales-returns?dateFrom=2026-10-13')).body) as {
      data: Array<{ id: string; returnNumber: string; orderNumber: string; requestedByName: string; receivedByName?: string; items: Array<{ productName: string; sku: string }> }>;
      meta: { total: number };
    };
    expect(day.data.map((r) => r.id)).toEqual([r1.id]);
    expect(day.data[0]).toMatchObject({ returnNumber: 'DEV-001', requestedByName: 'Test Admin' });
    expect(day.data[0]!.orderNumber).toMatch(/^ORD-/);
    expect(day.data[0]!.receivedByName).toBeUndefined(); // not received until inspected
    expect(day.data[0]!.items[0]!.productName).toMatch(/product sku-/i);
    expect(day.data[0]!.items[0]!.sku).toMatch(/^SKU-/);

    const range = JSON.parse((await get(f, '/api/v1/sales-returns?dateFrom=2026-10-11&dateTo=2026-10-13')).body) as { meta: { total: number } };
    expect(range.meta.total).toBe(2);
    const byLocation = JSON.parse((await get(f, `/api/v1/sales-returns?dateFrom=2026-10-11&dateTo=2026-10-13&locationId=${f.locationB}`)).body) as { data: Array<{ id: string }> };
    expect(byLocation.data.map((r) => r.id)).toEqual([r2.id]);
    expect((await get(f, '/api/v1/sales-returns?dateTo=2026-10-13')).statusCode).toBe(400);

    // Inspect sets receivedBy → the name is resolved on the detail.
    const returnItemId = (JSON.parse((await get(f, `/api/v1/sales-returns/${r1.id}`)).body) as { items: Array<{ id: string }> }).items[0]!.id;
    const inspected = await c.inject({
      method: 'POST',
      url: `/api/v1/sales-returns/${r1.id}/inspect`,
      headers: c.writeHeaders(f.admin),
      payload: { items: [{ returnItemId, disposition: 'restock', dispositionLocationId: f.locationA }] },
    });
    expect(inspected.statusCode, inspected.body).toBeLessThan(300);
    const detail = JSON.parse((await get(f, `/api/v1/sales-returns/${r1.id}`)).body) as { receivedByName?: string; requestedByName?: string };
    expect(detail.receivedByName).toBe('Test Admin');
    expect(detail.requestedByName).toBe('Test Admin');
  });

  it('returns report: same business-day + Almacén filters as the list (status=requested)', async () => {
    const f = await seed();
    const order = await makeOrder(f, f.locationA, { confirm: true });
    const rA = await makeReturn(f, order, f.locationA, 1);
    const rB = await makeReturn(f, order, f.locationB, 1);
    await backdate('return', rA.id, '2026-10-14T01:00:00Z'); // 13/10 20:00 local
    await backdate('return', rB.id, '2026-10-14T05:30:00Z'); // 14/10 00:30 local → outside the 13th

    const all = JSON.parse((await get(f, '/api/v1/reports/returns-summary?groupBy=day&status=requested&dateFrom=2026-10-13')).body) as {
      buckets: Array<{ returnCount: number; quantity: number }>;
    };
    expect(all.buckets.reduce((n, b) => n + b.returnCount, 0)).toBe(1);
    const other = JSON.parse((await get(f, `/api/v1/reports/returns-summary?groupBy=day&status=requested&dateFrom=2026-10-13&locationId=${f.locationB}`)).body) as { buckets: unknown[] };
    expect(other.buckets).toEqual([]);
    expect((await get(f, '/api/v1/reports/returns-summary?groupBy=day')).statusCode).toBe(400); // no range at all
  });

  it('numbering is per tenant: a second tenant starts again at DEV-001', async () => {
    const f1 = await seed();
    const o1 = await makeOrder(f1, f1.locationA, { confirm: true });
    expect((await makeReturn(f1, o1, f1.locationA)).returnNumber).toBe('DEV-001');
    const f2 = await seed();
    const o2 = await makeOrder(f2, f2.locationA, { confirm: true });
    expect((await makeReturn(f2, o2, f2.locationA)).returnNumber).toBe('DEV-001');
  });

  it('approvals: product + Almacén on the list, business-day and Almacén filters on list and report', async () => {
    const f = await seed();
    const orderA = await makeOrder(f, f.locationA, { negotiatedUnitPrice: 90 });
    const orderB = await makeOrder(f, f.locationB, { negotiatedUnitPrice: 90 });
    const post = async (order: { itemId: string }) => {
      const res = await c.inject({
        method: 'POST',
        url: '/api/v1/price-approvals',
        headers: c.writeHeaders(f.admin),
        payload: { orderItemId: order.itemId, reason: 'Cliente frecuente' },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (JSON.parse(res.body) as { id: string }).id;
    };
    const idA = await post(orderA);
    const idB = await post(orderB);
    await backdate('approval', idA, '2026-10-14T01:00:00Z'); // 13/10 20:00 local
    await backdate('approval', idB, '2026-10-11T15:00:00Z');

    const list = JSON.parse((await get(f, '/api/v1/price-approvals?dateFrom=2026-10-13')).body) as {
      data: Array<{ id: string; locationId: string; productName?: string; sku?: string }>;
    };
    expect(list.data.map((a) => a.id)).toEqual([idA]);
    expect(list.data[0]).toMatchObject({ locationId: f.locationA });
    expect(list.data[0]!.productName).toMatch(/product sku-/i);

    const wide = '/api/v1/price-approvals?dateFrom=2026-10-11&dateTo=2026-10-13';
    expect((JSON.parse((await get(f, wide)).body) as { meta: { total: number } }).meta.total).toBe(2);
    const onlyB = JSON.parse((await get(f, `${wide}&locationId=${f.locationB}`)).body) as { data: Array<{ id: string }> };
    expect(onlyB.data.map((a) => a.id)).toEqual([idB]);

    const report = (qs: string) => get(f, `/api/v1/reports/approvals-summary?groupBy=day&${qs}`);
    const total = (JSON.parse((await report('dateFrom=2026-10-11&dateTo=2026-10-13')).body) as { buckets: Array<{ requestCount: number }> }).buckets.reduce((n, b) => n + b.requestCount, 0);
    expect(total).toBe(2);
    const reportB = JSON.parse((await report(`dateFrom=2026-10-11&dateTo=2026-10-13&locationId=${f.locationB}`)).body) as { buckets: Array<{ requestCount: number }> };
    expect(reportB.buckets.reduce((n, b) => n + b.requestCount, 0)).toBe(1);
    const reportDay = JSON.parse((await report('dateFrom=2026-10-13')).body) as { buckets: Array<{ requestCount: number }> };
    expect(reportDay.buckets.reduce((n, b) => n + b.requestCount, 0)).toBe(1);
    expect((await report('dateTo=2026-10-13')).statusCode).toBe(400);
  });

  it('read scope (ADR-0024/0035): a restricted user only sees their locations in lists, details and reports; admin sees all', async () => {
    const f = await seed();
    const orderA = await makeOrder(f, f.locationA, { confirm: true });
    const orderB = await makeOrder(f, f.locationB, { confirm: true });
    const retA = await makeReturn(f, orderA, f.locationA);
    const retB = await makeReturn(f, orderB, f.locationB);
    const pendA = await makeOrder(f, f.locationA, { negotiatedUnitPrice: 90 });
    const pendB = await makeOrder(f, f.locationB, { negotiatedUnitPrice: 90 });
    const fileApproval = async (order: { itemId: string }) => {
      const res = await c.inject({ method: 'POST', url: '/api/v1/price-approvals', headers: c.writeHeaders(f.admin), payload: { orderItemId: order.itemId, reason: 'Cliente frecuente' } });
      expect(res.statusCode, res.body).toBe(201);
      return (JSON.parse(res.body) as { id: string }).id;
    };
    const apprA = await fileApproval(pendA);
    const apprB = await fileApproval(pendB);

    // Since migration 0044 a plain Vendedor sees only the orders THEY placed; this test is about the
    // LOCATION read scope across several sellers' documents, so the seller gets the Vendedor
    // permissions plus `sales.orders.view_all` (the seller-wide view the Administrador has).
    await c.createRole(f.admin, 'Vendedor con vista total', [...DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes, 'sales.orders.view_all']);
    const seller = await c.createAndLoginAs(f.admin, `seller-${uniq()}@ex.com`, 'Vendedor con vista total');
    await c.setUserLocations(f.admin, seller.user.id, [f.locationA]);
    const idle = await c.createAndLoginAs(f.admin, `idle-${uniq()}@ex.com`, 'Vendedor con vista total'); // no assignment at all

    const ids = (body: string): string[] => (JSON.parse(body) as { data: Array<{ id: string }> }).data.map((r) => r.id).sort();
    const status = async (who: Session, url: string): Promise<number> => (await c.inject({ method: 'GET', url, headers: c.readHeaders(who) })).statusCode;
    const body = async (who: Session, url: string): Promise<string> => (await c.inject({ method: 'GET', url, headers: c.readHeaders(who) })).body;

    // Orders
    expect(ids(await body(f.admin, '/api/v1/orders'))).toEqual([orderA.id, orderB.id, pendA.id, pendB.id].sort());
    expect(ids(await body(seller, '/api/v1/orders'))).toEqual([orderA.id, pendA.id].sort());
    expect(await status(seller, `/api/v1/orders?locationId=${f.locationB}`)).toBe(403);
    expect(await status(seller, `/api/v1/orders/${orderA.id}`)).toBe(200);
    expect(await status(seller, `/api/v1/orders/${orderB.id}`)).toBe(404);
    expect(await status(seller, `/api/v1/orders/${orderB.id}/notifications`)).toBe(404);
    expect(ids(await body(idle, '/api/v1/orders'))).toEqual([]);

    // Sales report
    const summary = async (who: Session, extra = ''): Promise<number> => {
      const res = await c.inject({ method: 'GET', url: `/api/v1/reports/sales-summary?groupBy=day&from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z${extra}`, headers: c.readHeaders(who) });
      expect(res.statusCode, res.body).toBe(200);
      return (JSON.parse(res.body) as { buckets: Array<{ orderCount: number }> }).buckets.reduce((n, b) => n + b.orderCount, 0);
    };
    expect(await summary(f.admin)).toBe(2);
    expect(await summary(seller)).toBe(1);
    expect(await summary(idle)).toBe(0);
    expect(await status(seller, `/api/v1/reports/sales-summary?groupBy=day&from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&locationId=${f.locationB}`)).toBe(403);

    // Returns
    expect(ids(await body(f.admin, '/api/v1/sales-returns'))).toEqual([retA.id, retB.id].sort());
    expect(ids(await body(seller, '/api/v1/sales-returns'))).toEqual([retA.id]);
    expect(await status(seller, `/api/v1/sales-returns?locationId=${f.locationB}`)).toBe(403);
    expect(await status(seller, `/api/v1/sales-returns/${retA.id}`)).toBe(200);
    expect(await status(seller, `/api/v1/sales-returns/${retB.id}`)).toBe(404);
    expect(ids(await body(idle, '/api/v1/sales-returns'))).toEqual([]);
    const retSummary = async (who: Session): Promise<number> => {
      const res = await c.inject({ method: 'GET', url: '/api/v1/reports/returns-summary?groupBy=day&status=requested&from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z', headers: c.readHeaders(who) });
      expect(res.statusCode, res.body).toBe(200);
      return (JSON.parse(res.body) as { buckets: Array<{ returnCount: number }> }).buckets.reduce((n, b) => n + b.returnCount, 0);
    };
    expect(await retSummary(f.admin)).toBe(2);
    expect(await retSummary(seller)).toBe(1);

    // Approvals (the Vendedor holds pricing.discount.request, so the queue is readable)
    expect(ids(await body(f.admin, '/api/v1/price-approvals'))).toEqual([apprA, apprB].sort());
    expect(ids(await body(seller, '/api/v1/price-approvals'))).toEqual([apprA]);
    expect(await status(seller, `/api/v1/price-approvals?locationId=${f.locationB}`)).toBe(403);
    expect(await status(seller, `/api/v1/price-approvals/${apprA}`)).toBe(200);
    expect(await status(seller, `/api/v1/price-approvals/${apprB}`)).toBe(404);
    expect(ids(await body(idle, '/api/v1/price-approvals'))).toEqual([]);
  });
});
