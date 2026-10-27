import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { buildMultipartUpload } from '../import/multipart';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, expectNoLeak, pdfText, uniq, withDb, xlsxText } from './iso-helpers';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * FASE 19 — HTTP audit of the aggregate reports (`sales-summary`, `payments`, `movements-summary`, `transfers-summary`,
 * `imports-summary`) and of the transfer free text (`notes` on create, `notes` on receive) and the transfers export.
 *
 * Two tenants (A with three sellers' worth of data, B with its own), real guards, real RLS. The questions:
 *  - the seller-scoped reports (`sales-summary`, `payments`): can a seller without `sales.orders.view_all` widen the scope with
 *    `placedByUserId`, `sellerName`, `customerId`, … and read another seller's totals / customers?
 *  - the inventory aggregates (`movements-summary`, `transfers-summary`): tenant-wide BY DESIGN (stock truth, ADR-0024) — pinned,
 *    and checked to carry no order reference, no free text and no other tenant's rows;
 *  - `imports-summary`: an `import.execute` surface — who is refused, and that no tenant sees another's job counters;
 *  - transfer notes: create-time `notes` are read from the transfers list / detail (warehouse text, pinned) but never reach the
 *    export or the ledger; receive-time `notes` are persisted and returned by NO route.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports and transfer notes — tenant and seller isolation (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');
  const NOTES_CREATE = `NOTA-CREA-${stamp()}`.toUpperCase();
  const NOTES_RECEIVE = `NOTA-RECIBE-${stamp()}`.toUpperCase();
  const FILE = `carga-${stamp()}.xlsx`;
  const RANGE = 'from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z';

  interface Tenant {
    admin: Session;
    tenantId: string;
    warehouseId: string;
    locA: string;
    locB: string;
    variantId: string;
    sku: string;
    customerMarker: string;
  }
  let A: Tenant;
  let B: Tenant;
  let s1: Session;
  let s2: Session;
  let viewAll: Session;
  let supervisor: Session;
  let bodega: Session;
  let noPerm: Session;
  let s1Marker = '';
  let s2Marker = '';
  let s1CustomerId = '';
  let s2CustomerId = '';
  const s2Orders: Array<{ id: string; orderNumber: string }> = [];
  let transferOpen = { id: '', code: '' };
  let transferDone = { id: '', code: '' };
  let transferB = { id: '', code: '' };
  let jobId = '';

  const post = (s: Session, url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    c.inject({ method: 'POST', url, headers: c.writeHeaders(s, extra), ...(payload !== undefined ? { payload } : {}) });
  const get = (s: Session | undefined, url: string) => c.inject({ method: 'GET', url, headers: s ? c.readHeaders(s) : {} });
  const json = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;

  async function seedTenant(label: string): Promise<Tenant> {
    const admin = await c.registerTenant(`Iso Rep ${label} ${stamp()}`, `iso-rep-${label}-${stamp()}@example.com`);
    const warehouseId = await c.createWarehouse(admin, `ISORW${label}-${stamp()}`);
    const locA = await c.createLocation(admin, warehouseId, `ISORA${label}-${stamp()}`);
    const locB = await c.createLocation(admin, warehouseId, `ISORB${label}-${stamp()}`);
    const sku = `ISOR${label}-${stamp()}`.toUpperCase();
    const { variantId } = await c.createProductVariant(admin, { sku, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, locA, 500);
    return { admin, tenantId: admin.user.tenantId, warehouseId, locA, locB, variantId, sku, customerMarker: '' };
  }

  async function confirmedOrder(t: Tenant, seller: Session, customerId: string, quantity: number, price: number): Promise<{ id: string; orderNumber: string }> {
    const cart = await post(seller, '/api/v1/cart', { locationId: t.locA, customerId });
    expect([200, 201], cart.body).toContain(cart.statusCode);
    const item = await post(seller, '/api/v1/cart/items', { productVariantId: t.variantId, quantity, negotiatedUnitPrice: price });
    expect(item.statusCode, item.body).toBe(200);
    const order = await post(seller, '/api/v1/orders', { cartId: json<{ id: string }>(cart).id, documentType: 'sales_note' }, { 'idempotency-key': randomUUID() });
    expect(order.statusCode, order.body).toBe(201);
    const body = json<{ id: string; total: number; orderNumber: string }>(order);
    const res = await post(seller, `/api/v1/orders/${body.id}/confirm`, { payments: [{ paymentMethod: 'cash', amount: body.total }] });
    expect(res.statusCode, res.body).toBe(200);
    return { id: body.id, orderNumber: body.orderNumber };
  }

  async function roleUser(t: Tenant, roleName: string, codes: string[]): Promise<Session> {
    await c.createRole(t.admin, roleName, [...new Set(codes)]);
    const s = await c.createAndLoginAs(t.admin, `${stamp()}-${roleName.toLowerCase().replace(/\W+/g, '')}@example.com`, roleName);
    await c.setUserLocations(t.admin, s.user.id, [t.locA, t.locB]);
    return s;
  }

  async function runTransfer(t: Tenant, notes: string, finish: boolean): Promise<{ id: string; code: string }> {
    const created = await post(t.admin, '/api/v1/inventory/transfers', { sourceLocationId: t.locA, destinationLocationId: t.locB, notes, items: [{ productVariantId: t.variantId, quantityRequested: 5 }] });
    expect(created.statusCode, created.body).toBe(201);
    const id = json<{ id: string }>(created).id;
    for (const step of ['approve', 'prepare']) expect((await post(t.admin, `/api/v1/inventory/transfers/${id}/${step}`)).statusCode, step).toBe(200);
    expect((await post(t.admin, `/api/v1/inventory/transfers/${id}/dispatch`, {})).statusCode).toBe(200);
    const detail = json<{ code: string; items: Array<{ id: string }> }>(await get(t.admin, `/api/v1/inventory/transfers/${id}`));
    if (finish) {
      const received = await post(t.admin, `/api/v1/inventory/transfers/${id}/receive`, { notes: NOTES_RECEIVE, items: [{ transferItemId: detail.items[0]!.id, quantityReceived: 5 }] }, { 'idempotency-key': randomUUID() });
      expect(received.statusCode, received.body).toBe(200);
    }
    return { id, code: detail.code };
  }

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildImportTestApp } = await import('../import/import-test-app');
    app = await buildImportTestApp();
    await app.init();
    c = makeClient(app);

    A = await seedTenant('A');
    B = await seedTenant('B');
    const sellerCodes = [...new Set(DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes)];
    s1 = await roleUser(A, 'Vendedor uno', sellerCodes);
    s2 = await roleUser(A, 'Vendedor dos', sellerCodes);
    viewAll = await roleUser(A, 'Vendedor vista total', [...sellerCodes, 'sales.orders.view_all']);
    noPerm = await roleUser(A, 'Sin permisos', []);
    supervisor = await c.createAndLoginAs(A.admin, `${stamp()}-supervisor@example.com`, 'Supervisor');
    bodega = await c.createAndLoginAs(A.admin, `${stamp()}-bodega@example.com`, 'Bodega');

    s1Marker = `isorsone${stamp()}`;
    s2Marker = `isorstwo${stamp()}`;
    A.customerMarker = s1Marker;
    B.customerMarker = `isorbcust${stamp()}`;
    s1CustomerId = await c.createCustomer(A.admin, c.fullCustomer(s1Marker));
    s2CustomerId = await c.createCustomer(A.admin, c.fullCustomer(s2Marker));
    const bCustomerId = await c.createCustomer(B.admin, c.fullCustomer(B.customerMarker));
    const bSeller = await roleUser(B, 'Vendedor B', sellerCodes);

    await confirmedOrder(A, s1, s1CustomerId, 4, 110);
    s2Orders.push(await confirmedOrder(A, s2, s2CustomerId, 2, 105));
    s2Orders.push(await confirmedOrder(A, s2, s2CustomerId, 3, 115));
    await confirmedOrder(B, bSeller, bCustomerId, 1, 100);

    transferOpen = await runTransfer(A, NOTES_CREATE, false);
    transferDone = await runTransfer(A, `${NOTES_CREATE}-2`, true);
    transferB = await runTransfer(B, `NOTA-B-${stamp()}`.toUpperCase(), false);

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Import');
    sheet.addRow(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad']);
    sheet.addRow([`ISORY-${stamp()}`.toUpperCase(), 'Producto importado', 150, 120, 100, 7]);
    const mapping = JSON.stringify({ SKU: 'sku', Nombre: 'name', 'Precio Max': 'maxPrice', 'Precio Base': 'basePrice', 'Precio Min': 'minPrice', Cantidad: 'quantity' });
    const { body, contentType } = buildMultipartUpload({ filename: FILE, contentType: XLSX_MIME, fileContent: Buffer.from(await wb.xlsx.writeBuffer()), fields: { columnMapping: mapping, defaultLocationId: A.locA } });
    const up = await c.inject({ method: 'POST', url: '/api/v1/imports', headers: { ...c.writeHeaders(A.admin), 'content-type': contentType }, body });
    expect(up.statusCode, up.body).toBe(201);
    jobId = json<{ id: string }>(up).id;
    expect((await post(A.admin, `/api/v1/imports/${jobId}/validate`)).statusCode).toBe(201);
    expect((await post(A.admin, `/api/v1/imports/${jobId}/confirm`)).statusCode).toBe(201);
  }, 400_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  type SalesSummary = { buckets: Array<{ key: string; orderCount: number; total: number; customerName?: string; sku?: string }> };
  const salesUrl = (extra = '') => `/api/v1/reports/sales-summary?${RANGE}&groupBy=customer${extra}`;
  const orderCount = (res: LightMyRequestResponse): number => json<SalesSummary>(res).buckets.reduce((n, b) => n + b.orderCount, 0);
  const ok = (res: LightMyRequestResponse) => {
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    return res;
  };

  it('ISO-LED-13 sales-summary: a seller without view_all gets only their own aggregate; no filter widens it; view_all/admin see all; tenant B sees none of A', async () => {
    expect(orderCount(ok(await get(A.admin, salesUrl()))), 'admin: 3 orders').toBe(3);
    expect(orderCount(ok(await get(viewAll, salesUrl()))), 'view_all: 3 orders').toBe(3);
    const own1 = ok(await get(s1, salesUrl()));
    expect(orderCount(own1), 's1: own order only').toBe(1);
    expect(own1.body.toLowerCase().includes(s1Marker), 's1 sees own customer').toBe(true);
    expect(own1.body.toLowerCase().includes(s2Marker), 's1 sees the other seller customer').toBe(false);
    const own2 = ok(await get(s2, salesUrl()));
    expect(orderCount(own2), 's2: own two orders').toBe(2);
    expect(own2.body.toLowerCase().includes(s1Marker), 's2 sees the other seller customer').toBe(false);

    // every way a caller could try to widen the scope — the aggregate must stay the caller's own
    for (const widen of [`&placedByUserId=${s2.user.id}`, `&customerId=${s2CustomerId}`, `&customerName=${s2Marker}`, `&q=${s2Marker}`, `&sellerName=Vendedor%20dos`, `&orderNumber=${s2Orders[0]!.orderNumber}`]) {
      const res = await get(s1, salesUrl(widen));
      expect([200, 400], `${widen} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(orderCount(res), `s1 with ${widen}: still only own (or fewer)`).toBeLessThanOrEqual(1);
        expect(res.body.toLowerCase().includes(s2Marker), `s1 with ${widen} leaks the other seller's customer`).toBe(false);
        for (const o of s2Orders) expect(res.body.includes(o.orderNumber) || res.body.includes(o.id), `s1 with ${widen} leaks an order reference`).toBe(false);
      }
    }
    // the legitimate narrowing: view_all picks one seller
    expect(orderCount(ok(await get(viewAll, salesUrl(`&placedByUserId=${s1.user.id}`)))), 'view_all narrows to s1').toBe(1);
    for (const groupBy of ['day', 'product']) {
      const res = ok(await get(s1, `/api/v1/reports/sales-summary?${RANGE}&groupBy=${groupBy}`));
      expect(res.body.toLowerCase().includes(s2Marker)).toBe(false);
      expect(orderCount(res), `s1 groupBy=${groupBy}`).toBe(1);
    }

    // tenant B: its own order only, never A's rows, and A's ids as filters return nothing
    const bOwn = ok(await get(B.admin, salesUrl()));
    expect(orderCount(bOwn), 'B sees its own order').toBe(1);
    expectNoLeak(bOwn.body, [s1Marker, s2Marker, A.tenantId, A.sku], 'B sales-summary');
    for (const filter of [`&customerId=${s1CustomerId}`, `&placedByUserId=${s1.user.id}`, `&locationId=${A.locA}`, `&warehouseId=${A.warehouseId}`, `&customerName=${s1Marker}`]) {
      const res = await get(B.admin, salesUrl(filter));
      expect([200, 400, 404], `${filter} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
      if (res.statusCode === 200) expect(orderCount(res), `B with A filter ${filter}`).toBe(0);
      expectNoLeak(res.body, [s1Marker, s2Marker, A.tenantId], `B sales-summary with ${filter}`);
    }

    expectDenied(await get(noPerm, salesUrl()), [403], 'no permission');
    expectDenied(await get(undefined, salesUrl()), [401], 'anonymous');
    expectDenied(await get(s1, `/api/v1/reports/sales-summary?from=2100-01-01T00:00:00Z&to=2020-01-01T00:00:00Z`), [400], 'inverted range');
    expectDenied(await get(s1, salesUrl('&placedByUserId=not-a-uuid')), [400], 'malformed seller id');
  });

  it('ISO-LED-14 payments report: placedByUserId cannot widen a seller; another tenant gets nothing; export follows', async () => {
    const q = 'dateFrom=2020-01-01&dateTo=2100-12-31&pageSize=100';
    for (const widen of ['', `&placedByUserId=${s2.user.id}`, `&customerName=${s2Marker}`]) {
      const res = ok(await get(s1, `/api/v1/reports/payments?${q}${widen}`));
      expect(res.body.toLowerCase().includes(s2Marker), `s1 payments${widen} leaks the other seller's customer`).toBe(false);
      const xl = ok(await get(s1, `/api/v1/reports/payments/export?${q}${widen}&format=xlsx`));
      expect((await xlsxText(xl.rawPayload)).includes(s2Marker), `s1 payments export${widen}`).toBe(false);
      for (const o of s2Orders) expect(res.body.includes(o.orderNumber), `s1 payments${widen} leaks ${o.orderNumber}`).toBe(false);
    }
    const all = ok(await get(viewAll, `/api/v1/reports/payments?${q}`));
    expect(all.body.toLowerCase().includes(s2Marker), 'positive control: view_all sees the other seller').toBe(true);
    const bRes = ok(await get(B.admin, `/api/v1/reports/payments?${q}&placedByUserId=${s2.user.id}`));
    expectNoLeak(bRes.body, [s1Marker, s2Marker, A.tenantId], 'B payments with A seller id');
  });

  it('ISO-LED-15 movements-summary and transfers-summary are tenant-wide inventory aggregates (pinned): no order reference, no free text, nothing of the other tenant', async () => {
    const mq = `/api/v1/reports/movements-summary?${RANGE}&groupBy=type`;
    for (const [name, who] of [['s1', s1], ['s2', s2], ['Supervisor', supervisor], ['Bodega', bodega], ['admin', A.admin]] as Array<[string, Session]>) {
      const m = ok(await get(who, mq));
      const t = ok(await get(who, '/api/v1/reports/transfers-summary?groupBy=variant'));
      for (const body of [m.body, t.body]) {
        for (const o of s2Orders) expect(body.includes(o.orderNumber) || body.includes(o.id), `${name}: order reference in an inventory aggregate`).toBe(false);
        expect(body.toUpperCase().includes(NOTES_CREATE) || body.toUpperCase().includes(NOTES_RECEIVE), `${name}: transfer notes in an aggregate`).toBe(false);
        expectNoLeak(body, [B.sku, B.tenantId], `${name}: tenant B data in an A aggregate`);
      }
    }
    // positive control and tenant isolation: A's open transfer is in A's in-transit total, never in B's other than B's own
    const aT = json<{ totals: { openTransferCount: number } }>(ok(await get(A.admin, '/api/v1/reports/transfers-summary?groupBy=status')));
    const bT = json<{ totals: { openTransferCount: number } }>(ok(await get(B.admin, '/api/v1/reports/transfers-summary?groupBy=status')));
    expect(aT.totals.openTransferCount, 'A: one open transfer').toBe(1);
    expect(bT.totals.openTransferCount, 'B: its own open transfer only').toBe(1);
    // foreign ids as filters from B: nothing of A
    for (const filter of [`&locationId=${A.locA}`, `&productVariantId=${A.variantId}`]) {
      const res = await get(B.admin, `${mq}${filter}`);
      expect([200, 400, 404], `${filter} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
      if (res.statusCode === 200) expect(json<{ buckets: unknown[] }>(res).buckets, `B movements-summary with A ${filter}`).toEqual([]);
      expectNoLeak(res.body, [A.sku, A.tenantId, A.locA], `B movements-summary ${filter}`);
    }
    for (const url of [mq, '/api/v1/reports/transfers-summary?groupBy=status']) {
      expectDenied(await get(noPerm, url), [403], `no permission ${url}`);
      expectDenied(await get(undefined, url), [401], `anonymous ${url}`);
    }
    expectDenied(await get(s1, `${mq}&locationId=not-a-uuid`), [400], 'malformed location');
  });

  it('ISO-LED-16 imports-summary: import.execute only; a tenant sees its own counters and nothing of another tenant\'s jobs', async () => {
    const q = `/api/v1/reports/imports-summary?${RANGE}&groupBy=status`;
    for (const [name, who] of [['s1', s1], ['Supervisor', supervisor], ['Bodega', bodega], ['no permission', noPerm]] as Array<[string, Session]>) {
      const res = await get(who, q);
      expect([403], `${name} -> ${res.statusCode} ${res.body.slice(0, 120)}`).toContain(res.statusCode);
    }
    expectDenied(await get(undefined, q), [401], 'anonymous');
    const a = json<{ totals: { jobCount: number; importedRows: number } }>(ok(await get(A.admin, q)));
    expect(a.totals.jobCount, 'A: its one job').toBe(1);
    expect(a.totals.importedRows).toBe(1);
    const bRes = ok(await get(B.admin, q));
    expect(json<{ totals: { jobCount: number } }>(bRes).totals.jobCount, 'B has no import job: A\'s counters are invisible').toBe(0);
    expectNoLeak(bRes.body, [jobId, FILE, A.tenantId], 'B imports-summary');
    expectDenied(await get(A.admin, `/api/v1/reports/imports-summary?${RANGE}&groupBy=nope`), [400], 'invalid groupBy');
  });

  it('ISO-LED-17 transfer notes: create-time notes are warehouse text served by the transfers list/detail (pinned), but never reach the export, the ledger or the aggregates; receive-time notes are persisted and returned by no route', async () => {
    // pinned: whoever may read transfers reads the create-time notes
    for (const [name, who] of [['s1', s1], ['Bodega', bodega], ['admin', A.admin]] as Array<[string, Session]>) {
      const detail = ok(await get(who, `/api/v1/inventory/transfers/${transferOpen.id}`));
      expect(json<{ notes?: string }>(detail).notes, `${name}: detail notes`).toBe(NOTES_CREATE);
      expect(ok(await get(who, '/api/v1/inventory/transfers?pageSize=100')).body.includes(NOTES_CREATE), `${name}: list notes`).toBe(true);
    }
    // not in the downloads, not in the ledger
    for (const [name, who] of [['s1', s1], ['Bodega', bodega], ['admin', A.admin]] as Array<[string, Session]>) {
      const xl = ok(await get(who, '/api/v1/inventory/transfers/export?format=xlsx'));
      const text = await xlsxText(xl.rawPayload);
      expect(text.includes(transferOpen.code.toLowerCase()), `${name}: positive control, transfer code in the export`).toBe(true);
      expect(text.includes(NOTES_CREATE.toLowerCase()) || text.includes(NOTES_RECEIVE.toLowerCase()), `${name}: notes in the xlsx export`).toBe(false);
      const pdf = ok(await get(who, '/api/v1/inventory/transfers/export?format=pdf'));
      const ptext = pdfText(pdf.rawPayload);
      expect(ptext.includes('transferencia') && ptext.includes('estado'), `${name}: positive control, the pdf headers are readable (the code may be wrapped by the column)`).toBe(true);
      expect(ptext.includes(NOTES_CREATE.toLowerCase()) || ptext.includes(NOTES_RECEIVE.toLowerCase()), `${name}: notes in the pdf export`).toBe(false);
    }
    // receive-time notes: persisted ...
    const stored = await withDb(async (db) => (await db.select().from(schema.inventoryTransferReceipts).where(eq(schema.inventoryTransferReceipts.transferId, transferDone.id)))[0]);
    expect(stored?.notes, 'the receive-time notes are persisted').toBe(NOTES_RECEIVE);
    // ... and returned by no read route
    const urls = [
      `/api/v1/inventory/transfers/${transferDone.id}`,
      '/api/v1/inventory/transfers?pageSize=100',
      `/api/v1/inventory/movements?productVariantId=${A.variantId}&pageSize=100`,
      `/api/v1/reports/kardex?productVariantId=${A.variantId}&locationId=${A.locB}`,
      '/api/v1/reports/transfers-summary?groupBy=status',
      `/api/v1/reports/movements-summary?${RANGE}&groupBy=type`,
    ];
    for (const url of urls) for (const [name, who] of [['s1', s1], ['admin', A.admin]] as Array<[string, Session]>) {
      expect(ok(await get(who, url)).body.toUpperCase().includes(NOTES_RECEIVE), `${name} ${url} returns the receive-time notes`).toBe(false);
    }
  });

  it('ISO-LED-18 transfers from another tenant: by id, list, export and filters give nothing of A; malformed ids and anonymous are refused', async () => {
    expectDenied(await get(B.admin, `/api/v1/inventory/transfers/${transferOpen.id}`), [404], 'B reads A transfer by id');
    expectDenied(await get(A.admin, `/api/v1/inventory/transfers/${transferB.id}`), [404], 'A reads B transfer by id');
    expectDenied(await get(s1, '/api/v1/inventory/transfers/not-a-uuid'), [400], 'malformed id');
    const marks = [transferOpen.code, transferDone.code, NOTES_CREATE, NOTES_RECEIVE, A.tenantId, A.locA, A.locB, A.sku];
    const list = ok(await get(B.admin, '/api/v1/inventory/transfers?pageSize=100'));
    expectNoLeak(list.body, marks, 'B transfers list');
    expect(list.body.includes(transferB.code), 'positive control: B sees its own transfer').toBe(true);
    for (const filter of [`&sourceLocationId=${A.locA}`, `&destinationLocationId=${A.locB}`, `&status=dispatched&sourceLocationId=${A.locA}`]) {
      const res = await get(B.admin, `/api/v1/inventory/transfers?pageSize=100${filter}`);
      expect([200, 400, 404], `${filter} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
      if (res.statusCode === 200) expect(json<{ data: unknown[] }>(res).data, `B with A filter ${filter}`).toEqual([]);
      expectNoLeak(res.body, marks, `B transfers ${filter}`);
    }
    const xl = ok(await get(B.admin, '/api/v1/inventory/transfers/export?format=xlsx'));
    expectNoLeak(await xlsxText(xl.rawPayload), marks, 'B transfers xlsx export');
    const pdf = ok(await get(B.admin, '/api/v1/inventory/transfers/export?format=pdf'));
    expectNoLeak(pdfText(pdf.rawPayload), marks, 'B transfers pdf export');
    for (const url of ['/api/v1/inventory/transfers', '/api/v1/inventory/transfers/export?format=xlsx', `/api/v1/inventory/transfers/${transferOpen.id}`]) {
      expectDenied(await get(undefined, url), [401], `anonymous ${url}`);
      expectDenied(await get(noPerm, url), [403], `no permission ${url}`);
    }
  });
});
