import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * Sales-history table: per-column filters (order number, customer, seller, total, notification
 * status) and per-column sorting on `GET /orders`, plus the same filters on `GET
 * /reports/sales-summary` so the cards above the table count exactly the rows it shows. Real
 * PostgreSQL — the filters/sorts are raw SQL fragments, so this is where they are actually proven.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: history columns — filters + sort (integration)', () => {
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
    vendedor: Session;
    locationId: string;
    variantId: string;
    /** order ids by total: 100 (admin), 200 (vendedor), 300 (admin, confirmed). */
    o100: string;
    o200: string;
    o300: string;
  }

  async function checkoutOrder(session: Session, f: { locationId: string; variantId: string }, customerId: string, quantity: number): Promise<string> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(session), payload: { locationId: f.locationId, customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(session), payload: { productVariantId: f.variantId, quantity } });
    expect(added.statusCode, added.body).toBe(200);
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(session, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    return (JSON.parse(order.body) as { id: string }).id;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, basePrice: 100, maxPrice: 120, minPrice: 80 });
    await c.receiveStock(admin, variantId, locationId, 100);
    const vendedor = await c.createAndLoginAs(admin, `vendedor@${email.split('@')[1]}`, 'Vendedor');
    await c.setUserLocations(admin, vendedor.user.id, [locationId]);

    const alpha = await c.createCustomer(admin, { ...c.fullCustomer('Alfa'), firstName: 'Alfa', lastName: 'Zeta' });
    const beta = await c.createCustomer(admin, { ...c.fullCustomer('Beta'), firstName: 'Beta', lastName: 'Omega' });
    const o100 = await checkoutOrder(admin, { locationId, variantId }, alpha, 1);
    const o200 = await checkoutOrder(vendedor, { locationId, variantId }, beta, 2);
    const o300 = await checkoutOrder(admin, { locationId, variantId }, alpha, 3);
    // Confirming creates the outbox event => notification "pending"; the other two have none.
    const confirmed = await c.inject({
      method: 'POST',
      url: `/api/v1/orders/${o300}/confirm`,
      headers: c.writeHeaders(admin),
      payload: { payments: [{ paymentMethod: 'cash', amount: 300 }] },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return { admin, vendedor, locationId, variantId, o100, o200, o300 };
  }

  const list = async (session: Session, query: string): Promise<{ id: string; total: number }[]> => {
    const res = await c.inject({ method: 'GET', url: `/api/v1/orders?pageSize=50&${query}`, headers: c.readHeaders(session) });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { data: { id: string; total: number }[] }).data;
  };

  const summaryCount = async (session: Session, query: string): Promise<number> => {
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    // Orders are `pending` except the confirmed one; count every status via two reads.
    let total = 0;
    for (const status of ['pending', 'confirmed']) {
      const res = await c.inject({ method: 'GET', url: `/api/v1/reports/sales-summary?from=${from}&to=${to}&groupBy=day&status=${status}&${query}`, headers: c.readHeaders(session) });
      expect(res.statusCode, res.body).toBe(200);
      total += (JSON.parse(res.body) as { buckets: { orderCount: number }[] }).buckets.reduce((n, b) => n + b.orderCount, 0);
    }
    return total;
  };

  it('filters by order number, customer name, seller name and total (substring, case-insensitive)', async () => {
    const f = await seed('Columns Filter Co', 'admin@columns-filter.example');

    const all = await list(f.admin, '');
    expect(all.map((o) => o.id).sort()).toEqual([f.o100, f.o200, f.o300].sort());

    const orderNumber = (await list(f.admin, '')).find((o) => o.id === f.o200) as unknown as { orderNumber: string };
    expect((await list(f.admin, `orderNumber=${encodeURIComponent(orderNumber.orderNumber.toLowerCase())}`)).map((o) => o.id)).toEqual([f.o200]);

    expect((await list(f.admin, 'customerName=omega')).map((o) => o.id)).toEqual([f.o200]);
    expect((await list(f.admin, 'customerName=zeta')).map((o) => o.id).sort()).toEqual([f.o100, f.o300].sort());

    expect((await list(f.admin, 'sellerName=vendedor')).map((o) => o.id)).toEqual([f.o200]);
    expect((await list(f.admin, 'sellerName=qa')).length + (await list(f.admin, 'sellerName=admin')).length).toBeGreaterThanOrEqual(0); // never errors

    expect((await list(f.admin, 'total=200')).map((o) => o.id)).toEqual([f.o200]);
    expect((await list(f.admin, 'total=00')).length).toBe(3);
    // LIKE metacharacters are matched literally, never as wildcards
    expect(await list(f.admin, `total=${encodeURIComponent('%')}`)).toEqual([]);
  });

  it('the single search box (q) matches order number OR customer OR seller, for the table and the cards', async () => {
    const f = await seed('Columns Q Co', 'admin@columns-q.example');
    expect((await list(f.admin, 'q=omega')).map((o) => o.id)).toEqual([f.o200]); // customer "Beta Omega"
    expect((await list(f.admin, 'q=vendedor')).map((o) => o.id)).toEqual([f.o200]); // seller "Vendedor User"
    expect((await list(f.admin, 'q=ORD-')).length).toBe(3); // order number
    expect(await list(f.admin, 'q=nadie-coincide')).toEqual([]);
    expect(await summaryCount(f.admin, 'q=omega')).toBe(1);
    expect(await summaryCount(f.admin, 'q=ORD-')).toBe(3);
    // combines (AND) with a column filter
    expect(await list(f.admin, 'q=zeta&total=300')).toHaveLength(1);
  });

  it('filters by the rolled-up notification status (confirmed order => pending event; others none)', async () => {
    const f = await seed('Columns Notif Co', 'admin@columns-notif.example');
    expect((await list(f.admin, 'notificationStatus=pending')).map((o) => o.id)).toEqual([f.o300]);
    expect((await list(f.admin, 'notificationStatus=none')).map((o) => o.id).sort()).toEqual([f.o100, f.o200].sort());
    expect(await list(f.admin, 'notificationStatus=failed')).toEqual([]);
    const bad = await c.inject({ method: 'GET', url: '/api/v1/orders?notificationStatus=bogus', headers: c.readHeaders(f.admin) });
    expect(bad.statusCode).toBe(400);
  });

  it('sorts by every column, asc and desc, with a stable default (newest first)', async () => {
    const f = await seed('Columns Sort Co', 'admin@columns-sort.example');
    const ids = async (q: string) => (await list(f.admin, q)).map((o) => o.id);

    // default: newest first
    expect(await ids('')).toEqual([f.o300, f.o200, f.o100]);
    expect(await ids('sort=createdAt&dir=asc')).toEqual([f.o100, f.o200, f.o300]);

    expect(await ids('sort=total&dir=asc')).toEqual([f.o100, f.o200, f.o300]);
    expect(await ids('sort=total&dir=desc')).toEqual([f.o300, f.o200, f.o100]);
    expect(await ids('sort=orderNumber&dir=asc')).toEqual([f.o100, f.o200, f.o300]);

    // customer (displayed "Nombre Apellido"): "Alfa Zeta" (o100/o300) < "Beta Omega" (o200)
    expect((await ids('sort=customer&dir=asc'))[2]).toBe(f.o200);
    expect((await ids('sort=customer&dir=desc'))[0]).toBe(f.o200);

    // seller: "Administrador…" < "Vendedor…"; the vendedor's order is last ascending / first descending
    expect((await ids('sort=seller&dir=asc'))[2]).toBe(f.o200);
    expect((await ids('sort=seller&dir=desc'))[0]).toBe(f.o200);

    // status: confirmed < pending alphabetically
    expect((await ids('sort=status&dir=asc'))[0]).toBe(f.o300);
    // notification: none < pending
    expect((await ids('sort=notification&dir=desc'))[0]).toBe(f.o300);
    // the remaining columns must at least be accepted and return every row
    for (const column of ['documentType', 'location']) {
      expect((await ids(`sort=${column}&dir=asc`)).length).toBe(3);
    }

    const bad = await c.inject({ method: 'GET', url: '/api/v1/orders?sort=bogus', headers: c.readHeaders(f.admin) });
    expect(bad.statusCode).toBe(400);
  });

  it('the sales-summary cards count exactly the rows the same column filters leave in the table', async () => {
    const f = await seed('Columns Cards Co', 'admin@columns-cards.example');
    expect(await summaryCount(f.admin, '')).toBe(3);
    expect(await summaryCount(f.admin, 'customerName=omega')).toBe(1);
    expect(await summaryCount(f.admin, 'sellerName=vendedor')).toBe(1);
    expect(await summaryCount(f.admin, 'total=300')).toBe(1);
    expect(await summaryCount(f.admin, 'orderNumber=ORD-')).toBe(3);
    expect(await summaryCount(f.admin, 'notificationStatus=pending')).toBe(1);
  });

  it('a seller cannot use the filters to reach other sellers\' orders (own scope is applied first)', async () => {
    const f = await seed('Columns Scope Co', 'admin@columns-scope.example');
    expect((await list(f.vendedor, '')).map((o) => o.id)).toEqual([f.o200]);
    expect(await list(f.vendedor, 'customerName=zeta')).toEqual([]); // zeta belongs to the admin's orders
    expect((await list(f.vendedor, 'sellerName=vendedor')).map((o) => o.id)).toEqual([f.o200]);
  });
});
