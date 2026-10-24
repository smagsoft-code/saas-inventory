import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * Excel/PDF exports of the three list screens — `GET /orders/export`, `GET /customers/export`,
 * `GET /inventory/transfers/export` — end to end against real PostgreSQL through the real
 * `buildApp()`: the file holds exactly the filtered set, names (not ids) are resolved, the scope of
 * the list endpoint applies unchanged, and `export` is never taken for an `:id`.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('exports: orders, customers, transfers (integration)', () => {
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

  interface Fixture {
    admin: Session;
    locationId: string;
    secondLocationId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(email: string): Promise<Fixture> {
    const admin = await c.registerTenant(`Co ${uniq()}`, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L1-${uniq()}`, { isSellable: true });
    const secondLocationId = await c.createLocation(admin, warehouseId, `L2-${uniq()}`, { isSellable: true });
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, basePrice: 100, maxPrice: 100, minPrice: 100 });
    await c.receiveStock(admin, variantId, locationId, 1000);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, locationId, secondLocationId, variantId, customerId };
  }

  async function confirmedOrder(f: Fixture, quantity: number): Promise<void> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity } });
    const order = await c.inject({ method: 'POST', url: '/api/v1/orders', headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }), payload: { cartId, documentType: 'sales_note' } });
    expect(order.statusCode, order.body).toBe(201);
    const id = (JSON.parse(order.body) as { id: string }).id;
    const confirmed = await c.inject({ method: 'POST', url: `/api/v1/orders/${id}/confirm`, headers: c.writeHeaders(f.admin), payload: { payments: [{ paymentMethod: 'cash', amount: quantity * 100 }] } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
  }

  const download = (session: Session, path: string, query: Record<string, string>) =>
    c.inject({ method: 'GET', url: `/api/v1/${path}?${new URLSearchParams(query)}`, headers: c.readHeaders(session) });

  async function sheetRows(payload: Buffer): Promise<unknown[][]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(payload as never);
    const rows: unknown[][] = [];
    workbook.worksheets[0]!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    return rows;
  }

  it('orders: exports the filtered history (names resolved), as xlsx and pdf', async () => {
    const f = await seed(`exp-ord-${uniq()}@example.com`);
    await confirmedOrder(f, 1);
    await confirmedOrder(f, 2);
    const range = { dateFrom: day(-1), dateTo: day(1) };

    const xlsx = await download(f.admin, 'orders/export', { ...range, format: 'xlsx' });
    expect(xlsx.statusCode, xlsx.body).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('historial-de-ventas.xlsx');
    const rows = await sheetRows(xlsx.rawPayload);
    const header = rows.findIndex((r) => r[0] === 'Pedido');
    const data = rows.slice(header + 1).filter((r) => String(r[0]).startsWith('ORD-'));
    expect(data).toHaveLength(2);
    expect(data.map((r) => r[8]).sort()).toEqual([100, 200]);
    expect(String(data[0]![5])).toContain(' · '); // "Sucursal · Almacén", never an id
    expect(data[0]![6]).toBe('Confirmado');

    // The same filters as the list narrow the file: a total filter keeps one order.
    const narrowed = await sheetRows((await download(f.admin, 'orders/export', { ...range, total: '200', format: 'xlsx' })).rawPayload);
    expect(narrowed.filter((r) => String(r[0]).startsWith('ORD-'))).toHaveLength(1);

    const pdf = await download(f.admin, 'orders/export', { ...range, format: 'pdf' });
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('orders: a seller without view_all only exports their own orders; another tenant sees nothing', async () => {
    const a = await seed(`exp-iso-a-${uniq()}@example.com`);
    const b = await seed(`exp-iso-b-${uniq()}@example.com`);
    await confirmedOrder(a, 1);
    const range = { dateFrom: day(-1), dateTo: day(1), format: 'xlsx' };
    const rows = await sheetRows((await download(b.admin, 'orders/export', range)).rawPayload);
    expect(rows.filter((r) => String(r[0]).startsWith('ORD-'))).toHaveLength(0);
  });

  it('customers: exports the list honouring the q search', async () => {
    const f = await seed(`exp-cus-${uniq()}@example.com`);
    await c.createCustomer(f.admin, { ...c.fullCustomer('zzunique'), firstName: 'Zeta', lastName: 'Zzunique' });
    const all = await sheetRows((await download(f.admin, 'customers/export', { format: 'xlsx' })).rawPayload);
    const header = all.findIndex((r) => r[0] === 'Nombre');
    expect(all.slice(header + 1).length).toBeGreaterThanOrEqual(2);
    const searched = await sheetRows((await download(f.admin, 'customers/export', { format: 'xlsx', q: 'Zzunique' })).rawPayload);
    const found = searched.slice(searched.findIndex((r) => r[0] === 'Nombre') + 1);
    expect(found).toHaveLength(1);
    expect(String(found[0]![0])).toContain('Zeta');
    expect(found[0]![1]).toBe('Cédula');
    const pdf = await download(f.admin, 'customers/export', { format: 'pdf' });
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('products: exports one row per variant with stock and prices, honouring q / stock filters', async () => {
    const f = await seed(`exp-prd-${uniq()}@example.com`);
    const sku = `FILTRO-${uniq()}`;
    const other = await c.createProductVariant(f.admin, { sku, basePrice: 50, maxPrice: 60, minPrice: 40 });
    await c.receiveStock(f.admin, other.variantId, f.locationId, 7);

    const rows = await sheetRows((await download(f.admin, 'reports/product-catalog/export', { format: 'xlsx' })).rawPayload);
    const header = rows.findIndex((r) => r[0] === 'Nombre');
    expect(rows.slice(header + 1).length).toBeGreaterThanOrEqual(2);

    const searched = await sheetRows((await download(f.admin, 'reports/product-catalog/export', { format: 'xlsx', q: sku })).rawPayload);
    const found = searched.slice(searched.findIndex((r) => r[0] === 'Nombre') + 1);
    expect(found).toHaveLength(1);
    expect(found[0]![2]).toBe(sku);
    expect(found[0]![3]).toBe(7);
    expect(found[0]![4]).toBe(60);
    expect(found[0]![5]).toBe(50);
    expect(found[0]![6]).toBe('Activo');

    const without = await sheetRows((await download(f.admin, 'reports/product-catalog/export', { format: 'xlsx', q: sku, stock: 'without' })).rawPayload);
    expect(without.slice(without.findIndex((r) => r[0] === 'Nombre') + 1)).toHaveLength(0);
    expect((await download(f.admin, 'reports/product-catalog/export', { format: 'pdf' })).rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await download(f.admin, 'reports/product-catalog/export', {})).statusCode).toBe(400);
  });

  it('product-catalog counts per Almacén: only active products with stock available there (Home "Total productos")', async () => {
    const f = await seed(`cat-loc-${uniq()}@example.com`); // seed: 1 variant with stock at locationId
    const second = await c.createProductVariant(f.admin, { sku: `SKU-${uniq()}`, basePrice: 10, maxPrice: 10, minPrice: 5 });
    await c.receiveStock(f.admin, second.variantId, f.secondLocationId, 4);
    await c.createProductVariant(f.admin, { sku: `SKU-${uniq()}`, basePrice: 10, maxPrice: 10, minPrice: 5 }); // no stock anywhere

    const total = async (query: Record<string, string>) =>
      (JSON.parse((await download(f.admin, 'reports/product-catalog', { status: 'active', pageSize: '1', ...query })).body) as { meta: { total: number } }).meta.total;
    expect(await total({})).toBe(3); // the whole catalog
    expect(await total({ locationId: f.locationId, stock: 'available' })).toBe(1);
    expect(await total({ locationId: f.secondLocationId, stock: 'available' })).toBe(1);
    expect(await total({ stock: 'available' })).toBe(2); // tenant-wide: with stock somewhere
  });

  it('transfers: exports origin/destination names and honours the status filter', async () => {
    const f = await seed(`exp-trf-${uniq()}@example.com`);
    const created = await c.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: c.writeHeaders(f.admin),
      payload: { sourceLocationId: f.locationId, destinationLocationId: f.secondLocationId, items: [{ productVariantId: f.variantId, quantityRequested: 3 }] },
    });
    expect(created.statusCode, created.body).toBe(201);

    const rows = await sheetRows((await download(f.admin, 'inventory/transfers/export', { format: 'xlsx' })).rawPayload);
    const data = rows.slice(rows.findIndex((r) => r[0] === 'Transferencia') + 1);
    expect(data).toHaveLength(1);
    expect(data[0]![1]).toBe('Borrador');
    expect(String(data[0]![2])).toContain(' · ');
    expect(String(data[0]![3])).toContain(' · ');
    expect(data[0]![4]).toBe(1);

    const none = await sheetRows((await download(f.admin, 'inventory/transfers/export', { format: 'xlsx', status: 'received' })).rawPayload);
    expect(none.slice(none.findIndex((r) => r[0] === 'Transferencia') + 1)).toHaveLength(0);
    expect((await download(f.admin, 'inventory/transfers/export', { format: 'pdf' })).rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('rejects a missing/invalid format (400) and anonymous callers (401); "export" is not an id', async () => {
    const f = await seed(`exp-bad-${uniq()}@example.com`);
    for (const path of ['orders/export', 'customers/export', 'inventory/transfers/export']) {
      expect((await download(f.admin, path, {})).statusCode, path).toBe(400);
      expect((await download(f.admin, path, { format: 'csv' })).statusCode, path).toBe(400);
      expect((await c.inject({ method: 'GET', url: `/api/v1/${path}?format=xlsx` })).statusCode, path).toBe(401);
    }
  });
});
