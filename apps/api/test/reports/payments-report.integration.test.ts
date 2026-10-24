import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * `GET /reports/payments` (+ `/export`) end to end against real PostgreSQL through the real
 * `buildApp()`: one row per `order_payments` row (split payment = two rows), totals over the whole
 * filtered set, the return flag, tenant isolation, seller scope and the xlsx/pdf downloads.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: payments (integration)', () => {
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
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  /** A window wide enough to contain "now" in any tenant timezone. */
  const range = { dateFrom: day(-1), dateTo: day(1) };

  interface Fixture {
    admin: Session;
    locationId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(email: string): Promise<Fixture> {
    const admin = await c.registerTenant(`Co ${uniq()}`, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`, { isSellable: true });
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, basePrice: 100, maxPrice: 100, minPrice: 100 });
    await c.receiveStock(admin, variantId, locationId, 1000);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, locationId, variantId, customerId };
  }

  async function confirmedOrder(
    f: Fixture,
    seller: Session,
    payments: { paymentMethod: string; amount: number }[],
    quantity: number,
  ): Promise<{ orderId: string; orderItemId: string }> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(seller), payload: { locationId: f.locationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(seller), payload: { productVariantId: f.variantId, quantity } });
    expect(added.statusCode, added.body).toBe(200);
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(seller, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    const body = JSON.parse(order.body) as { id: string; items: { id: string }[] };
    const confirmed = await c.inject({ method: 'POST', url: `/api/v1/orders/${body.id}/confirm`, headers: c.writeHeaders(seller), payload: { payments } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return { orderId: body.id, orderItemId: body.items[0]!.id };
  }

  const get = (session: Session, path: string, query: Record<string, string>) =>
    c.inject({ method: 'GET', url: `/api/v1/reports/${path}?${new URLSearchParams(query)}`, headers: c.readHeaders(session) });

  interface PaymentsBody {
    totals: { paymentCount: number; amount: number; byMethod: { paymentMethod: string; paymentCount: number; amount: number }[] };
    data: { orderNumber: string; paymentMethod: string; amount: number; sellerName?: string; locationLabel: string; returns?: { count: number; numbers: string[]; returnedValue: number } }[];
    meta: { total: number };
  }

  it('lists one row per payment of a split-payment order, with totals by method', async () => {
    const f = await seed(`pay-split-${uniq()}@example.com`);
    await confirmedOrder(f, f.admin, [{ paymentMethod: 'cash', amount: 40 }, { paymentMethod: 'card', amount: 60 }], 1);

    const res = await get(f.admin, 'payments', range);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as PaymentsBody;
    expect(body.data).toHaveLength(2);
    expect(body.data.map((r) => r.paymentMethod).sort()).toEqual(['card', 'cash']);
    expect(body.data[0]!.sellerName).toBeTruthy();
    expect(body.data[0]!.locationLabel).toContain(' · ');
    expect(body.totals.amount).toBe(100);
    expect(body.totals.paymentCount).toBe(2);
    expect(body.totals.byMethod).toEqual(
      expect.arrayContaining([
        { paymentMethod: 'cash', paymentCount: 1, amount: 40 },
        { paymentMethod: 'card', paymentCount: 1, amount: 60 },
      ]),
    );
    expect(body.data.every((r) => r.returns === undefined)).toBe(true);

    const filtered = JSON.parse((await get(f.admin, 'payments', { ...range, paymentMethod: 'card' })).body) as PaymentsBody;
    expect(filtered.data).toHaveLength(1);
    expect(filtered.totals.amount).toBe(60);
  });

  it('flags every payment of an order that has a non-cancelled return', async () => {
    const f = await seed(`pay-ret-${uniq()}@example.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, f.admin, [{ paymentMethod: 'cash', amount: 200 }], 2);
    const created = await c.inject({
      method: 'POST',
      url: '/api/v1/sales-returns',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { orderId, locationId: f.locationId, reason: 'integration test', items: [{ orderItemId, quantity: 1 }] },
    });
    expect(created.statusCode, created.body).toBe(201);

    const body = JSON.parse((await get(f.admin, 'payments', range)).body) as PaymentsBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.returns).toMatchObject({ count: 1, returnedValue: 100 });
    expect(body.data[0]!.returns!.numbers[0]).toMatch(/^DEV-/);
    // The payment is not reversed: the amount stays the originally charged one.
    expect(body.data[0]!.amount).toBe(200);
  });

  it('never leaks another tenant\'s payments', async () => {
    const a = await seed(`pay-iso-a-${uniq()}@example.com`);
    const b = await seed(`pay-iso-b-${uniq()}@example.com`);
    await confirmedOrder(a, a.admin, [{ paymentMethod: 'transfer', amount: 100 }], 1);
    const body = JSON.parse((await get(b.admin, 'payments', range)).body) as PaymentsBody;
    expect(body.data).toHaveLength(0);
    expect(body.totals).toMatchObject({ paymentCount: 0, amount: 0 });
  });

  it('answers 400 without dateFrom and 401 anonymous', async () => {
    const f = await seed(`pay-400-${uniq()}@example.com`);
    expect((await get(f.admin, 'payments', {})).statusCode).toBe(400);
    expect((await c.inject({ method: 'GET', url: `/api/v1/reports/payments?${new URLSearchParams(range)}` })).statusCode).toBe(401);
  });

  it('exports the filtered set as xlsx and pdf', async () => {
    const f = await seed(`pay-exp-${uniq()}@example.com`);
    await confirmedOrder(f, f.admin, [{ paymentMethod: 'cash', amount: 100 }], 1);
    const xlsx = await get(f.admin, 'payments/export', { ...range, format: 'xlsx' });
    expect(xlsx.statusCode, xlsx.body).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const pdf = await get(f.admin, 'payments/export', { ...range, format: 'pdf' });
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await get(f.admin, 'payments/export', range)).statusCode).toBe(400);
  });
});
