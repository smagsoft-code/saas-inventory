import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { buildMultipartUpload } from '../import/multipart';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Cell = string | number | null;

async function workbook(rows: Cell[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Carga');
  sheet.addRow(['Código', 'Cantidad', 'Costo unitario', 'Motivo']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * "Carga masiva de stock" against real PostgreSQL + RLS: preview (writes nothing), all-or-nothing
 * confirm, double-submit protection, the single movement date, and RBAC / location authorization.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('inventory: bulk stock load (integration)', () => {
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
    warehouseId: string;
    locationId: string;
    skuA: string;
    skuB: string;
    variantA: string;
    variantB: string;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const warehouseId = await c.createWarehouse(admin, `WH-${stamp}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${stamp}`);
    const skuA = `BA-${stamp}`.toUpperCase();
    const skuB = `BB-${stamp}`.toUpperCase();
    const a = await c.createProductVariant(admin, { sku: skuA });
    const b = await c.createProductVariant(admin, { sku: skuB });
    return { admin, warehouseId, locationId, skuA, skuB, variantA: a.variantId, variantB: b.variantId };
  }

  async function post(session: Session, path: string, rows: Cell[][], fields: Record<string, string>, extraHeaders: Record<string, string> = {}) {
    const { body, contentType } = buildMultipartUpload({ filename: 'carga.xlsx', contentType: XLSX_MIME, fileContent: await workbook(rows), fields });
    return c.inject({ method: 'POST', url: path, headers: { ...c.writeHeaders(session, extraHeaders), 'content-type': contentType }, body });
  }

  const preview = (s: Session, rows: Cell[][], fields: Record<string, string>) => post(s, '/api/v1/inventory/receipts/bulk/preview', rows, fields);
  const confirm = (s: Session, rows: Cell[][], fields: Record<string, string>, key: string = randomUUID()) =>
    post(s, '/api/v1/inventory/receipts/bulk', rows, fields, { 'idempotency-key': key });

  async function physical(s: Session, variantId: string, locationId: string): Promise<number> {
    const res = await c.inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}&locationId=${locationId}`, headers: c.readHeaders(s) });
    expect(res.statusCode, res.body).toBe(200);
    const row = (JSON.parse(res.body) as { data: { quantityPhysical: number }[] }).data[0];
    return row?.quantityPhysical ?? 0;
  }

  it('the template downloads as an .xlsx', async () => {
    const f = await seed('Bulk Tpl Co', 'admin@bulk-tpl.example');
    const res = await c.inject({ method: 'GET', url: '/api/v1/inventory/receipts/bulk/template', headers: c.readHeaders(f.admin) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('preview reports every row with its errors and writes NOTHING', async () => {
    const f = await seed('Bulk Preview Co', 'admin@bulk-preview.example');
    const res = await preview(
      f.admin,
      [[f.skuA, 5, 10, 'Compra'], ['NO-EXISTE', 1, 1, 'x'], [f.skuB, 0, 3, '']],
      { locationId: f.locationId },
    );
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body) as { totalRows: number; validRows: number; invalidRows: number; rows: { rowNumber: number; errors: string[] }[] };
    expect(body).toMatchObject({ totalRows: 3, validRows: 1, invalidRows: 2 });
    expect(body.rows[1]!.errors.join(' ')).toMatch(/No existe un producto/);
    expect(body.rows[2]!.errors.join(' ')).toMatch(/cantidad debe ser mayor que 0/);
    expect(await physical(f.admin, f.variantA, f.locationId)).toBe(0);
  });

  it('ALL OR NOTHING: one bad row => 422 and the valid rows are not loaded either', async () => {
    const f = await seed('Bulk AllNothing Co', 'admin@bulk-allnothing.example');
    const res = await confirm(f.admin, [[f.skuA, 5, 10, 'Compra'], ['NO-EXISTE', 1, 1, 'x']], { locationId: f.locationId });
    expect(res.statusCode, res.body).toBe(422);
    expect(await physical(f.admin, f.variantA, f.locationId)).toBe(0);
  });

  it('a clean file loads every row as a RECEIPT with its cost and reason, updating the balances and the Kardex', async () => {
    const f = await seed('Bulk Load Co', 'admin@bulk-load.example');
    const res = await confirm(f.admin, [[f.skuA, 5, 10, 'Compra a proveedor'], [f.skuB.toLowerCase(), 3, 4.5, 'Producción propia']], { locationId: f.locationId });
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ loadedRows: 2, totalQuantity: 8 });
    expect(await physical(f.admin, f.variantA, f.locationId)).toBe(5);
    expect(await physical(f.admin, f.variantB, f.locationId)).toBe(3);

    const kardex = await c.inject({ method: 'GET', url: `/api/v1/reports/kardex?productVariantId=${f.variantA}&locationId=${f.locationId}`, headers: c.readHeaders(f.admin) });
    expect(kardex.statusCode, kardex.body).toBe(200);
    const rows = (JSON.parse(kardex.body) as { rows: { label: string; entrada: number; unitCost?: number }[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Ingreso de stock: Compra a proveedor', entrada: 5, unitCost: 10 });
  });

  it('DOUBLE SUBMIT: the same Idempotency-Key loads the stock once; a different file with that key is a 409', async () => {
    const f = await seed('Bulk Idem Co', 'admin@bulk-idem.example');
    const key = randomUUID();
    const rows: Cell[][] = [[f.skuA, 5, 10, 'Compra']];
    const first = await confirm(f.admin, rows, { locationId: f.locationId }, key);
    const second = await confirm(f.admin, rows, { locationId: f.locationId }, key);
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body));
    expect(await physical(f.admin, f.variantA, f.locationId)).toBe(5); // once, not 10

    const different = await confirm(f.admin, [[f.skuA, 6, 10, 'Compra']], { locationId: f.locationId }, key);
    expect(different.statusCode).toBe(409);
    expect(await physical(f.admin, f.variantA, f.locationId)).toBe(5);

    const noKey = await post(f.admin, '/api/v1/inventory/receipts/bulk', rows, { locationId: f.locationId });
    expect(noKey.statusCode).toBe(400);
  });

  it('concurrent submits with the same key still load the stock exactly once', async () => {
    const f = await seed('Bulk Race Co', 'admin@bulk-race.example');
    const key = randomUUID();
    const rows: Cell[][] = [[f.skuA, 7, 2, 'Compra']];
    const results = await Promise.all([1, 2, 3].map(() => confirm(f.admin, rows, { locationId: f.locationId }, key)));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(await physical(f.admin, f.variantA, f.locationId)).toBe(7);
  });

  it('the movement date: a past day stamps noon of that day; a future date is rejected (400) and nothing is loaded', async () => {
    const f = await seed('Bulk Date Co', 'admin@bulk-date.example');
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const ok = await confirm(f.admin, [[f.skuA, 2, 1, 'Compra']], { locationId: f.locationId, occurredOn: past });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(JSON.parse(ok.body).occurredAt).toBe(`${past}T12:00:00.000Z`);

    const movements = await c.inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${f.variantA}`, headers: c.readHeaders(f.admin) });
    const first = (JSON.parse(movements.body) as { data: { occurredAt: string }[] }).data[0]!;
    expect(first.occurredAt).toBe(`${past}T12:00:00.000Z`);

    const future = await confirm(f.admin, [[f.skuB, 2, 1, 'Compra']], { locationId: f.locationId, occurredOn: '2999-01-01' });
    expect(future.statusCode).toBe(400);
    expect(await physical(f.admin, f.variantB, f.locationId)).toBe(0);
  });

  it('RBAC + location authorization: no inventory.adjust => 403; a Bodega user restricted to another almacén => 403', async () => {
    const f = await seed('Bulk Rbac Co', 'admin@bulk-rbac.example');
    const rows: Cell[][] = [[f.skuA, 1, 1, 'x']];

    const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@bulk-rbac.example', 'Vendedor');
    expect((await preview(vendedor, rows, { locationId: f.locationId })).statusCode).toBe(403);

    const otherLocation = await c.createLocation(f.admin, f.warehouseId, `L2-${Date.now()}`);
    const bodega = await c.createAndLoginAs(f.admin, 'bodega@bulk-rbac.example', 'Bodega');
    await c.setUserLocations(f.admin, bodega.user.id, [otherLocation]);
    expect((await confirm(bodega, rows, { locationId: f.locationId })).statusCode).toBe(403);
    expect(await physical(f.admin, f.variantA, f.locationId)).toBe(0);
    // ...but into their own almacén it works
    expect((await confirm(bodega, rows, { locationId: otherLocation })).statusCode).toBe(201);
  });

  it('cross-tenant: another tenant\'s codes are unknown, and its almacén is a 404', async () => {
    const a = await seed('Bulk XT A Co', 'admin@bulk-xt-a.example');
    const b = await seed('Bulk XT B Co', 'admin@bulk-xt-b.example');
    const unknownCode = await preview(a.admin, [[b.skuA, 1, 1, 'x']], { locationId: a.locationId });
    expect(JSON.parse(unknownCode.body).rows[0].errors.join(' ')).toMatch(/No existe un producto/);
    const foreignLocation = await preview(a.admin, [[a.skuA, 1, 1, 'x']], { locationId: b.locationId });
    expect(foreignLocation.statusCode).toBe(404);
  });
});
