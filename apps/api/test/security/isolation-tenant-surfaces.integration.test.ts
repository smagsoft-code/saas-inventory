import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { buildMultipartUpload } from '../import/multipart';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, expectNoLeak, uniq, withDb, xlsxRowCount, xlsxText } from './iso-helpers';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * GAP-F19-RLS-IDOR-DEPTH — HTTP tenant-isolation sweep, TENANT surfaces added or changed after QA 5S:
 * `sales.orders.view_all` scope, order payments, bulk stock load, import jobs, list/report exports,
 * Kardex and inventory movements. Real `buildApp()` over HTTP, real PostgreSQL, two isolated tenants.
 *
 * Method per surface: legitimate access for each tenant (positive control, so a "nothing leaked" result is
 * never vacuous) → cross-tenant reads and writes by changing ids / filters / bodies → anonymous and
 * no-permission callers → read the database back to prove no side effect. Case ids (ISO-VA/PAY/BULK/IMP/EXP/KRD-nn)
 * are what docs/security/tenant-isolation-http-matrix.md refers to. Status codes follow each endpoint's own
 * contract (404 for a foreign resource, 403 for a missing permission, 400 for malformed input).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('tenant isolation over HTTP — tenant surfaces (view_all, payments, bulk load, imports, exports, Kardex)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  interface Tenant {
    label: string;
    admin: Session;
    tenantId: string;
    warehouseId: string;
    warehouseCode: string;
    locationId: string;
    locationCode: string;
    sku: string;
    variantId: string;
    productId: string;
    /** customer used by the admin; its name is the marker searched for in downloads */
    customerId: string;
    customerMarker: string;
  }
  let A: Tenant;
  let B: Tenant;
  /** A's sellers, an unrestricted-view role and a role with no permissions at all. */
  let s1: Session;
  let s2: Session;
  let viewAll: Session;
  let noPerm: Session;
  let c1: { id: string; marker: string };
  let c2: { id: string; marker: string };

  const asCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  async function seedTenant(label: string): Promise<Tenant> {
    const stamp = uniq().replace(/[^a-z0-9]/gi, '');
    const email = `iso-${label}-${stamp}@example.com`;
    const admin = await c.registerTenant(`Iso ${label} ${stamp}`, email);
    const warehouseCode = asCode(`ISOW-${label}-${stamp}`);
    const warehouseId = await c.createWarehouse(admin, warehouseCode);
    const locationCode = asCode(`ISOL-${label}-${stamp}`);
    const locationId = await c.createLocation(admin, warehouseId, locationCode);
    const sku = asCode(`ISOSKU-${label}-${stamp}`);
    const { variantId, productId } = await c.createProductVariant(admin, { sku, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, locationId, 50);
    const customerMarker = `iso${label}cust${stamp}`.toLowerCase();
    const customerId = await c.createCustomer(admin, c.fullCustomer(customerMarker));
    return { label, admin, tenantId: admin.user.tenantId, warehouseId, warehouseCode, locationId, locationCode, sku, variantId, productId, customerId, customerMarker };
  }

  async function newCustomer(admin: Session, marker: string): Promise<{ id: string; marker: string }> {
    return { id: await c.createCustomer(admin, c.fullCustomer(marker)), marker: marker.toLowerCase() };
  }

  async function roleUser(t: Tenant, roleName: string, codes: string[], withLocation: boolean): Promise<Session> {
    await c.createRole(t.admin, roleName, codes);
    const session = await c.createAndLoginAs(t.admin, `${asCode(roleName).toLowerCase()}-${uniq()}@example.com`, roleName);
    if (withLocation) await c.setUserLocations(t.admin, session.user.id, [t.locationId]);
    return session;
  }

  beforeAll(async () => {
    setIntegrationEnv();
    // Same app as buildApp() but with an in-memory ObjectStorageService (no S3 in the test environment) —
    // Postgres, RLS, guards and every route are the real ones.
    const { buildImportTestApp } = await import('../import/import-test-app');
    app = await buildImportTestApp();
    await app.init();
    c = makeClient(app);
    A = await seedTenant('a');
    B = await seedTenant('b');
    const sellerCodes = [...new Set([...DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes, 'sales.orders.cancel'])];
    s1 = await roleUser(A, 'Vendedor sonda 1', sellerCodes, true);
    s2 = await roleUser(A, 'Vendedor sonda 2', sellerCodes, true);
    viewAll = await roleUser(A, 'Vendedor vista total', [...new Set([...sellerCodes, 'sales.orders.view_all'])], true);
    noPerm = await roleUser(A, 'Sin permisos', [], true);
    c1 = await newCustomer(A.admin, `isoacustone${uniq().replace(/[^a-z0-9]/gi, '')}`);
    c2 = await newCustomer(A.admin, `isoacusttwo${uniq().replace(/[^a-z0-9]/gi, '')}`);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- small HTTP helpers --------------------------------------------------------------------
  const get = (s: Session, url: string) => c.inject({ method: 'GET', url, headers: c.readHeaders(s) });
  const post = (s: Session, url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    c.inject({ method: 'POST', url, headers: c.writeHeaders(s, extra), ...(payload !== undefined ? { payload } : {}) });
  const json = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;
  const ids = (res: LightMyRequestResponse): string[] => json<{ data: Array<{ id: string }> }>(res).data.map((r) => r.id);

  async function placeOrder(s: Session, t: Tenant, customerId: string): Promise<{ id: string; total: number }> {
    const cart = await post(s, '/api/v1/cart', { locationId: t.locationId, customerId });
    expect([200, 201], cart.body).toContain(cart.statusCode);
    const cartId = json<{ id: string }>(cart).id;
    const item = await post(s, '/api/v1/cart/items', { productVariantId: t.variantId, quantity: 1 });
    expect(item.statusCode, item.body).toBe(200);
    const order = await post(s, '/api/v1/orders', { cartId, documentType: 'sales_note' }, { 'idempotency-key': randomUUID() });
    expect(order.statusCode, order.body).toBe(201);
    return json<{ id: string; total: number }>(order);
  }
  const confirm = (s: Session, o: { id: string; total: number }, body?: unknown) =>
    post(s, `/api/v1/orders/${o.id}/confirm`, body ?? { payments: [{ paymentMethod: 'cash', amount: o.total }] });

  const orderState = (id: string) =>
    withDb(async (db) => {
      const [o] = await db.select({ status: schema.orders.status, tenantId: schema.orders.tenantId }).from(schema.orders).where(eq(schema.orders.id, id));
      return o;
    });
  const paymentCount = (orderId: string) => withDb(async (db) => (await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, orderId))).length);
  const movementCount = (tenantId: string) => withDb(async (db) => (await db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.tenantId, tenantId))).length);
  const physicalAt = (tenantId: string, variantId: string, locationId: string) =>
    withDb(async (db) => {
      const [row] = await db
        .select({ q: schema.inventoryBalances.quantityPhysical })
        .from(schema.inventoryBalances)
        .where(and(eq(schema.inventoryBalances.tenantId, tenantId), eq(schema.inventoryBalances.productVariantId, variantId), eq(schema.inventoryBalances.locationId, locationId)));
      return Number(row?.q ?? 0);
    });

  // ================================================================================================
  // sales.orders.view_all
  // ================================================================================================
  describe('sales.orders.view_all scope', () => {
    let o1: { id: string; total: number }; // s1, confirmed
    let o2: { id: string; total: number }; // s2, pending
    let o2c: { id: string; total: number }; // s2, confirmed
    let ob: { id: string; total: number }; // tenant B admin, pending

    beforeAll(async () => {
      o1 = await placeOrder(s1, A, c1.id);
      expect((await confirm(s1, o1)).statusCode).toBe(200);
      o2 = await placeOrder(s2, A, c2.id);
      o2c = await placeOrder(s2, A, c2.id);
      expect((await confirm(s2, o2c)).statusCode).toBe(200);
      ob = await placeOrder(B.admin, B, B.customerId);
    }, 120_000);

    it('ISO-VA-01 a seller WITHOUT view_all sees only their own orders — in lists, details, notifications and exports', async () => {
      const list = await get(s1, '/api/v1/orders?pageSize=100');
      expect(list.statusCode, list.body).toBe(200);
      const seen = ids(list);
      expect(seen).toContain(o1.id);
      for (const foreign of [o2.id, o2c.id, ob.id]) expect(seen, `s1 must not list ${foreign}`).not.toContain(foreign);

      for (const foreign of [o2.id, o2c.id, ob.id]) {
        expectDenied(await get(s1, `/api/v1/orders/${foreign}`), [404], `s1 reading order ${foreign}`);
        expectDenied(await get(s1, `/api/v1/orders/${foreign}/notifications`), [404], `s1 reading notifications ${foreign}`);
      }
      expect((await get(s1, `/api/v1/orders/${o1.id}`)).statusCode).toBe(200);

      const exp = await get(s1, '/api/v1/orders/export?format=xlsx');
      expect(exp.statusCode, exp.body.slice(0, 200)).toBe(200);
      const text = await xlsxText(exp.rawPayload);
      expect(text, 'positive control: own order is in the export').toContain(c1.marker);
      expectNoLeak(text, [c2.marker, B.customerMarker], 's1 orders export');
    });

    it('ISO-VA-02 query tampering cannot widen the scope: for a seller without view_all every filter is intersected with their OWN orders; B filtering by A ids gets nothing', async () => {
      const own = [o1.id];
      for (const q of ['placedByUserId=' + s2.user.id, 'placedByUserId=' + B.admin.user.id, 'customerId=' + c2.id, 'locationId=' + A.locationId]) {
        const res = await get(s1, '/api/v1/orders?pageSize=100&' + q);
        expect([200, 403, 404], q + ' -> ' + res.body).toContain(res.statusCode);
        if (res.statusCode === 200) {
          for (const id of ids(res)) expect(own, 's1 filter ' + q + ' returned a non-own order ' + id).toContain(id);
          expectNoLeak(res.body, [c2.marker, B.customerMarker], 's1 filter ' + q);
        }
      }
      // tenant B admin asking for A's customer / location / seller: nothing of A, ever.
      for (const q of ['customerId=' + c1.id, 'locationId=' + A.locationId, 'placedByUserId=' + s1.user.id, 'warehouseId=' + A.warehouseId]) {
        const res = await get(B.admin, '/api/v1/orders?pageSize=100&' + q);
        expect([200, 403, 404], q + ' -> ' + res.body).toContain(res.statusCode);
        if (res.statusCode === 200) {
          for (const id of ids(res)) expect([o1.id, o2.id, o2c.id], 'B filter ' + q).not.toContain(id);
        }
      }
    });

    it('ISO-VA-03a WRITE scope: a seller cannot CANCEL another seller\'s order — it is hidden from them (404) exactly as on read, and nothing changes', async () => {
      const victim = await placeOrder(s2, A, c2.id); // a fresh pending order of s2
      const res = await post(s1, '/api/v1/orders/' + victim.id + '/cancel');
      expectDenied(res, [403, 404], 's1 cancelling s2 pending order');
      expect((await orderState(victim.id))?.status, 'the order must still be pending').toBe('pending');
      // tenant B cannot cancel it either
      expectDenied(await post(B.admin, '/api/v1/orders/' + victim.id + '/cancel'), [404], 'B admin cancelling A order');
      expect((await orderState(victim.id))?.status).toBe('pending');
    });

    it('ISO-VA-03b WRITE scope: a seller cannot CONFIRM another seller\'s order (no payment, no stock commit, status unchanged); B cannot either', async () => {
      const victim = await placeOrder(s2, A, c2.id);
      const movementsBefore = await movementCount(A.tenantId);
      const res = await confirm(s1, victim);
      expectDenied(res, [403, 404], 's1 confirming s2 pending order');
      expect((await orderState(victim.id))?.status).toBe('pending');
      expect(await paymentCount(victim.id)).toBe(0);
      expect(await movementCount(A.tenantId)).toBe(movementsBefore);
      expectDenied(await confirm(B.admin, victim), [404], 'B admin confirming A order');
      expect((await orderState(victim.id))?.status).toBe('pending');
      expect(await paymentCount(victim.id)).toBe(0);
    });

    it('ISO-VA-03c the legitimate owner and a view_all holder CAN act: the owner confirms their own order; view_all cancels another seller\'s (positive control)', async () => {
      const mine = await placeOrder(s1, A, c1.id);
      expect((await confirm(s1, mine)).statusCode).toBe(200);
      const theirs = await placeOrder(s2, A, c2.id);
      expect((await post(viewAll, '/api/v1/orders/' + theirs.id + '/cancel')).statusCode).toBe(200);
      expect((await orderState(theirs.id))?.status).toBe('cancelled');
    });

    it('ISO-VA-04 view_all is TENANT-wide, never platform-wide: it sees every seller of A but nothing of B, and cannot write to B', async () => {
      const list = await get(viewAll, '/api/v1/orders?pageSize=100');
      expect(list.statusCode, list.body).toBe(200);
      const seen = ids(list);
      for (const own of [o1.id, o2.id, o2c.id]) expect(seen).toContain(own);
      expect(seen).not.toContain(ob.id);
      expectDenied(await get(viewAll, `/api/v1/orders/${ob.id}`), [404], 'view_all reading B order');
      expectDenied(await get(viewAll, `/api/v1/orders/${ob.id}/notifications`), [404], 'view_all reading B notifications');
      expectDenied(await post(viewAll, `/api/v1/orders/${ob.id}/cancel`), [404], 'view_all cancelling B order');
      expect((await orderState(ob.id))?.status).toBe('pending');

      const exp = await xlsxText((await get(viewAll, '/api/v1/orders/export?format=xlsx')).rawPayload);
      expect(exp).toContain(c1.marker);
      expect(exp).toContain(c2.marker);
      expectNoLeak(exp, [B.customerMarker], 'view_all orders export');

      // symmetric: B's admin (who holds view_all by default) sees B only.
      const bSeen = ids(await get(B.admin, '/api/v1/orders?pageSize=100'));
      expect(bSeen).toContain(ob.id);
      for (const foreign of [o1.id, o2.id, o2c.id]) expect(bSeen).not.toContain(foreign);
    });

    it('ISO-VA-05 anonymous is 401 and a role with no sales permissions is 403 on list, detail, notifications, export and writes', async () => {
      const routes = [
        { method: 'GET' as const, url: '/api/v1/orders' },
        { method: 'GET' as const, url: `/api/v1/orders/${o1.id}` },
        { method: 'GET' as const, url: `/api/v1/orders/${o1.id}/notifications` },
        { method: 'GET' as const, url: '/api/v1/orders/export?format=xlsx' },
        { method: 'POST' as const, url: `/api/v1/orders/${o2.id}/cancel` },
        { method: 'POST' as const, url: `/api/v1/orders/${o2.id}/confirm`, payload: { payments: [{ paymentMethod: 'cash', amount: 1 }] } },
      ];
      for (const r of routes) {
        const anon = await c.inject({ method: r.method, url: r.url, ...('payload' in r ? { payload: r.payload } : {}) });
        expectDenied(anon, [401], `anonymous ${r.method} ${r.url}`);
        const denied = await c.inject({
          method: r.method,
          url: r.url,
          headers: r.method === 'GET' ? c.readHeaders(noPerm) : c.writeHeaders(noPerm),
          ...('payload' in r ? { payload: r.payload } : {}),
        });
        expectDenied(denied, [403], `no-permission ${r.method} ${r.url}`);
      }
      expect((await orderState(o2.id))?.status).toBe('pending');
    });
  });

  // ================================================================================================
  // Order payments
  // ================================================================================================
  describe('order payments', () => {
    it('ISO-PAY-01 another tenant cannot attach payments to (confirm) an order: 404, no payment row, no stock movement, order unchanged', async () => {
      const order = await placeOrder(A.admin, A, A.customerId);
      const movementsBefore = await movementCount(A.tenantId);
      const res = await confirm(B.admin, order);
      expectDenied(res, [404], 'B confirming A order');
      expect(await paymentCount(order.id)).toBe(0);
      expect((await orderState(order.id))?.status).toBe('pending');
      expect(await movementCount(A.tenantId)).toBe(movementsBefore);
      expectNoLeak(res.body, [A.customerMarker, A.tenantId], 'cross-tenant confirm response');
    });

    it('ISO-PAY-02 body tampering is rejected (400) with no side effect; only the legitimate confirm writes payments, under the right tenant', async () => {
      const order = await placeOrder(A.admin, A, A.customerId);
      const bad: unknown[] = [
        { payments: [{ paymentMethod: 'cash', amount: order.total }], orderId: order.id, tenantId: B.tenantId },
        { payments: [{ paymentMethod: 'cash', amount: order.total, orderId: NIL, tenantId: B.tenantId }] },
        { payments: [{ paymentMethod: 'cash', amount: -5 }] },
        { payments: [{ paymentMethod: 'cash', amount: 0 }] },
        { payments: [{ paymentMethod: 'cash', amount: '10' }] },
        { payments: [{ paymentMethod: 'bitcoin', amount: 10 }] },
        { payments: [] },
        {},
      ];
      for (const body of bad) expectDenied(await confirm(A.admin, order, body), [400], `bad confirm ${JSON.stringify(body)}`);
      expect(await paymentCount(order.id)).toBe(0);
      expect((await orderState(order.id))?.status).toBe('pending');

      const ok = await confirm(A.admin, order);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await paymentCount(order.id)).toBe(1);
      await withDb(async (db) => {
        const rows = await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, order.id));
        expect(rows.every((r) => r.tenantId === A.tenantId)).toBe(true);
      });
      // B cannot add a payment to the now-confirmed order either, and A's count is unchanged.
      expectDenied(await confirm(B.admin, order), [404], 'B confirming a confirmed A order');
      expect(await paymentCount(order.id)).toBe(1);
    });

    it('ISO-PAY-03 payments report and export are tenant-scoped; foreign filters return nothing foreign; sellers without view_all see only their own', async () => {
      const q = 'dateFrom=2020-01-01&dateTo=2100-12-31&pageSize=100';
      const own = await get(A.admin, `/api/v1/reports/payments?${q}`);
      expect(own.statusCode, own.body).toBe(200);
      expect(own.body.toLowerCase(), 'positive control: A sees its own payments').toContain(A.customerMarker);
      expectNoLeak(own.body, [B.customerMarker, B.tenantId], 'A payments report');

      const bRep = await get(B.admin, `/api/v1/reports/payments?${q}`);
      expect(bRep.statusCode, bRep.body).toBe(200);
      expectNoLeak(bRep.body, [A.customerMarker, c1.marker, c2.marker, A.tenantId, A.locationId], 'B payments report');

      for (const filter of [`locationId=${A.locationId}`, `warehouseId=${A.warehouseId}`, `placedByUserId=${s1.user.id}`, `customerName=${c1.marker}`]) {
        const res = await get(B.admin, `/api/v1/reports/payments?${q}&${filter}`);
        expect([200, 400, 403, 404], `${filter} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
        expectNoLeak(res.body, [A.customerMarker, c1.marker, c2.marker], `B payments report with A filter ${filter}`);
      }

      // seller scope: s1 paid order o1? (it is in the previous describe) — here: s1/s2 only ever see their own customers.
      const s1Rep = await get(s1, `/api/v1/reports/payments?${q}`);
      expect(s1Rep.statusCode, s1Rep.body).toBe(200);
      expectNoLeak(s1Rep.body, [c2.marker, B.customerMarker], 's1 payments report');

      const exp = await get(B.admin, `/api/v1/reports/payments/export?${q}&format=xlsx`);
      expect(exp.statusCode, exp.body.slice(0, 160)).toBe(200);
      expectNoLeak(await xlsxText(exp.rawPayload), [A.customerMarker, c1.marker, c2.marker], 'B payments export');
      const ownExp = await xlsxText((await get(A.admin, `/api/v1/reports/payments/export?${q}&format=xlsx`)).rawPayload);
      expect(ownExp).toContain(A.customerMarker);

      for (const url of [`/api/v1/reports/payments?${q}`, `/api/v1/reports/payments/export?${q}&format=xlsx`]) {
        expectDenied(await c.inject({ method: 'GET', url }), [401], `anonymous ${url}`);
        expectDenied(await get(noPerm, url), [403], `no-permission ${url}`);
      }
    });

    it('ISO-PAY-04 the order-creation Idempotency-Key is tenant-scoped: the SAME key in two tenants yields two independent orders, and each replay returns its own', async () => {
      const key = randomUUID();
      const mk = async (s: Session, t: Tenant) => {
        const cart = await post(s, '/api/v1/cart', { locationId: t.locationId, customerId: t.customerId });
        const cartId = json<{ id: string }>(cart).id;
        await post(s, '/api/v1/cart/items', { productVariantId: t.variantId, quantity: 1 });
        return post(s, '/api/v1/orders', { cartId, documentType: 'sales_note' }, { 'idempotency-key': key });
      };
      const a = await mk(A.admin, A);
      const b = await mk(B.admin, B);
      expect(a.statusCode, a.body).toBe(201);
      expect(b.statusCode, b.body).toBe(201);
      const aId = json<{ id: string }>(a).id;
      const bId = json<{ id: string }>(b).id;
      expect(aId).not.toBe(bId);
      expect((await orderState(bId))?.tenantId).toBe(B.tenantId);
      expectNoLeak(b.body, [A.customerMarker, A.tenantId], 'B order created with A\'s key');

      // Replays: each tenant gets ITS OWN stored response (same key, same id), never the other's.
      const aCart = await post(A.admin, '/api/v1/cart', { locationId: A.locationId, customerId: A.customerId });
      const aReplay = await post(A.admin, '/api/v1/orders', { cartId: json<{ id: string }>(aCart).id, documentType: 'sales_note' }, { 'idempotency-key': key });
      expect([200, 201, 409, 400, 404]).toContain(aReplay.statusCode);
      if (aReplay.statusCode === 200 || aReplay.statusCode === 201) expect(json<{ id: string }>(aReplay).id).toBe(aId);
      expectNoLeak(aReplay.body, [B.customerMarker, bId], 'A replay');
      // And A can never read B's order by the id it might have learned.
      expectDenied(await get(A.admin, `/api/v1/orders/${bId}`), [404], 'A reading B order');
    });
  });

  // ================================================================================================
  // Bulk stock load
  // ================================================================================================
  describe('bulk stock load (inventory/receipts/bulk)', () => {
    async function workbook(rows: Array<Array<string | number>>): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Carga');
      sheet.addRow(['Código', 'Cantidad', 'Costo unitario', 'Motivo']);
      for (const row of rows) sheet.addRow(row);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
    async function bulk(s: Session, path: string, rows: Array<Array<string | number>>, fields: Record<string, string>, extra: Record<string, string> = {}) {
      const { body, contentType } = buildMultipartUpload({ filename: 'carga.xlsx', contentType: XLSX_MIME, fileContent: await workbook(rows), fields });
      return c.inject({ method: 'POST', url: path, headers: { ...c.writeHeaders(s, extra), 'content-type': contentType }, body });
    }
    const preview = (s: Session, rows: Array<Array<string | number>>, fields: Record<string, string>) => bulk(s, '/api/v1/inventory/receipts/bulk/preview', rows, fields);
    const load = (s: Session, rows: Array<Array<string | number>>, fields: Record<string, string>, key = randomUUID()) =>
      bulk(s, '/api/v1/inventory/receipts/bulk', rows, fields, { 'idempotency-key': key });

    it('ISO-BULK-01 foreign locations and foreign SKU codes are refused: nothing is written in A or B', async () => {
      const mA = await movementCount(A.tenantId);
      const mB = await movementCount(B.tenantId);
      const stockA = await physicalAt(A.tenantId, A.variantId, A.locationId);

      // B targets A's location (id learned out of band) with A's SKU.
      const p1 = await preview(B.admin, [[A.sku, 5, 10, 'x']], { locationId: A.locationId });
      expectDenied(p1, [404, 403, 422], 'B preview into A location');
      const l1 = await load(B.admin, [[A.sku, 5, 10, 'x']], { locationId: A.locationId });
      expectDenied(l1, [404, 403, 422], 'B load into A location');
      // B targets its own location but with A's SKU code → unknown product.
      const l2 = await load(B.admin, [[A.sku, 5, 10, 'x']], { locationId: B.locationId });
      expectDenied(l2, [422], 'B load of A sku into B location');
      const p2 = await preview(B.admin, [[A.sku, 5, 10, 'x']], { locationId: B.locationId });
      expect(p2.statusCode, p2.body).toBe(201);
      expect(json<{ validRows: number }>(p2).validRows).toBe(0);
      // A targets B's location with A's own SKU.
      expectDenied(await load(A.admin, [[A.sku, 5, 10, 'x']], { locationId: B.locationId }), [404, 403, 422], 'A load into B location');

      expect(await movementCount(A.tenantId)).toBe(mA);
      expect(await movementCount(B.tenantId)).toBe(mB);
      expect(await physicalAt(A.tenantId, A.variantId, A.locationId)).toBe(stockA);
      expectNoLeak(p1.body + l1.body + l2.body, [A.warehouseCode, A.locationCode], 'bulk refusal bodies');
    });

    it('ISO-BULK-02 the Idempotency-Key is tenant-scoped: the same key in A and B loads each tenant\'s own stock, and an A replay never repeats or crosses', async () => {
      const key = randomUUID();
      const a0 = await physicalAt(A.tenantId, A.variantId, A.locationId);
      const b0 = await physicalAt(B.tenantId, B.variantId, B.locationId);
      const first = await load(A.admin, [[A.sku, 3, 10, 'iso a']], { locationId: A.locationId }, key);
      expect(first.statusCode, first.body).toBe(201);
      const second = await load(B.admin, [[B.sku, 4, 10, 'iso b']], { locationId: B.locationId }, key);
      expect(second.statusCode, second.body).toBe(201);
      expectNoLeak(second.body, [A.sku, A.locationId], 'B bulk response with A key');
      expect(await physicalAt(A.tenantId, A.variantId, A.locationId)).toBe(a0 + 3);
      expect(await physicalAt(B.tenantId, B.variantId, B.locationId)).toBe(b0 + 4);

      const replay = await load(A.admin, [[A.sku, 3, 10, 'iso a']], { locationId: A.locationId }, key);
      expect([200, 201, 409]).toContain(replay.statusCode);
      expectNoLeak(replay.body, [B.sku, B.locationId], 'A replay');
      expect(await physicalAt(A.tenantId, A.variantId, A.locationId), 'a replayed key must not load twice').toBe(a0 + 3);
      expect(await physicalAt(B.tenantId, B.variantId, B.locationId)).toBe(b0 + 4);
    });

    it('ISO-BULK-03 extra multipart fields cannot redirect the load to another tenant; anonymous is 401; roles without inventory.adjust are 403; nothing is written', async () => {
      const mA = await movementCount(A.tenantId);
      const b0 = await physicalAt(B.tenantId, B.variantId, B.locationId);
      const steered = await load(B.admin, [[B.sku, 2, 10, 'steer']], { locationId: B.locationId, tenantId: A.tenantId, createdBy: A.admin.user.id });
      expect([201, 400, 422], steered.body).toContain(steered.statusCode);
      expect(await movementCount(A.tenantId), 'a steered upload must not land in A').toBe(mA);
      if (steered.statusCode === 201) expect(await physicalAt(B.tenantId, B.variantId, B.locationId)).toBe(b0 + 2);

      const before = await movementCount(A.tenantId);
      for (const [path, fn] of [
        ['/api/v1/inventory/receipts/bulk/preview', preview],
        ['/api/v1/inventory/receipts/bulk', load],
      ] as const) {
        const { body, contentType } = buildMultipartUpload({ filename: 'carga.xlsx', contentType: XLSX_MIME, fileContent: await workbook([[A.sku, 1, 1, 'x']]), fields: { locationId: A.locationId } });
        expectDenied(await c.inject({ method: 'POST', url: path, headers: { 'content-type': contentType, 'idempotency-key': randomUUID() }, body }), [401], `anonymous ${path}`);
        expectDenied(await fn(noPerm, [[A.sku, 1, 1, 'x']], { locationId: A.locationId }), [403], `no-permission ${path}`);
        expectDenied(await fn(s1, [[A.sku, 1, 1, 'x']], { locationId: A.locationId }), [403], `seller without inventory.adjust ${path}`);
      }
      expectDenied(await c.inject({ method: 'GET', url: '/api/v1/inventory/receipts/bulk/template' }), [401], 'anonymous template');
      expectDenied(await get(noPerm, '/api/v1/inventory/receipts/bulk/template'), [403], 'no-permission template');
      expect(await movementCount(A.tenantId)).toBe(before);
    });
  });

  // ================================================================================================
  // Import jobs (upload, tracking, results, downloads)
  // ================================================================================================
  describe('import jobs', () => {
    const MAPPING = JSON.stringify({ Código: 'sku', Nombre: 'name', 'Precio máximo': 'maxPrice', 'Precio base': 'basePrice', 'Precio mínimo': 'minPrice' });
    const HEADERS = ['Código', 'Nombre', 'Precio máximo', 'Precio base', 'Precio mínimo'];
    async function xlsx(rows: Array<Array<string | number>>): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Import');
      sheet.addRow(HEADERS);
      for (const row of rows) sheet.addRow(row);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
    async function upload(s: Session, rows: Array<Array<string | number>>, fields: Record<string, string> = {}, filename = 'import.xlsx') {
      const { body, contentType } = buildMultipartUpload({ filename, contentType: XLSX_MIME, fileContent: await xlsx(rows), fields: { columnMapping: MAPPING, ...fields } });
      return c.inject({ method: 'POST', url: '/api/v1/imports', headers: { ...c.writeHeaders(s), 'content-type': contentType }, body });
    }
    const jobRow = (id: string) => withDb(async (db) => (await db.select().from(schema.importJobs).where(eq(schema.importJobs.id, id)))[0]);
    const jobRowCount = (id: string) => withDb(async (db) => (await db.select().from(schema.importJobRows).where(eq(schema.importJobRows.importJobId, id))).length);

    let jobId: string;
    let goodMarker: string;
    let badMarker: string;

    beforeAll(async () => {
      goodMarker = asCode(`IMPOK-${uniq()}`);
      badMarker = asCode(`IMPBAD-${uniq()}`);
      // one valid row and one invalid row (no name) so the error report has content
      const created = await upload(A.admin, [[goodMarker, 'Producto importado', 100, 90, 80], [badMarker, '', 100, 90, 80]]);
      expect(created.statusCode, created.body).toBe(201);
      jobId = json<{ id: string }>(created).id;
      const validated = await post(A.admin, `/api/v1/imports/${jobId}/validate`);
      expect([200, 201, 202], validated.body).toContain(validated.statusCode);
    }, 60_000);

    it('ISO-IMP-01 A can drive and read its own job (positive control), and the job belongs to A', async () => {
      for (const path of ['', '/preview', '/rows']) expect((await get(A.admin, `/api/v1/imports/${jobId}${path}`)).statusCode, `A GET ${path}`).toBe(200);
      const errors = await get(A.admin, `/api/v1/imports/${jobId}/errors`);
      expect(errors.statusCode, errors.body.slice(0, 120)).toBe(200);
      // positive control: the report has the header plus at least one error row (it lists row numbers / messages, not raw cells)
      expect(await xlsxRowCount(errors.rawPayload)).toBeGreaterThan(1);
      expect((await jobRow(jobId))?.tenantId).toBe(A.tenantId);
      expect(ids(await get(A.admin, '/api/v1/imports?pageSize=100'))).toContain(jobId);
    });

    it('ISO-IMP-02 B cannot read, drive or cancel A\'s job (status, preview, rows, errors, mapping, validate, confirm, cancel): all 404, job and rows unchanged', async () => {
      const job0 = await jobRow(jobId);
      const rows0 = await jobRowCount(jobId);
      const stock0 = await physicalAt(A.tenantId, A.variantId, A.locationId);
      for (const path of ['', '/preview', '/rows', '/errors']) {
        const res = await get(B.admin, `/api/v1/imports/${jobId}${path}`);
        expectDenied(res, [404], `B GET /imports/:id${path}`);
        expectNoLeak(res.body, [goodMarker, badMarker, A.tenantId], `B GET /imports/:id${path}`);
      }
      for (const [path, payload] of [
        ['/mapping', { columnMapping: JSON.parse(MAPPING) as Record<string, string> }],
        ['/validate', undefined],
        ['/confirm', undefined],
        ['/cancel', undefined],
      ] as const) {
        expectDenied(await post(B.admin, `/api/v1/imports/${jobId}${path}`, payload), [404], `B POST /imports/:id${path}`);
      }
      const job1 = await jobRow(jobId);
      expect(job1?.status, 'job status must be untouched').toBe(job0?.status);
      expect(job1?.updatedAt?.getTime()).toBe(job0?.updatedAt?.getTime());
      expect(await jobRowCount(jobId)).toBe(rows0);
      expect(await physicalAt(A.tenantId, A.variantId, A.locationId)).toBe(stock0);
      expect(ids(await get(B.admin, '/api/v1/imports?pageSize=100'))).not.toContain(jobId);
    });

    it('ISO-IMP-03 anonymous is 401 and roles without import.execute are 403 on every import route (upload included); nothing is created', async () => {
      const jobsBefore = await withDb(async (db) => (await db.select().from(schema.importJobs).where(eq(schema.importJobs.tenantId, A.tenantId))).length);
      const routes = [
        { method: 'GET' as const, url: '/api/v1/imports' },
        { method: 'GET' as const, url: '/api/v1/imports/template' },
        { method: 'GET' as const, url: `/api/v1/imports/${jobId}` },
        { method: 'GET' as const, url: `/api/v1/imports/${jobId}/errors` },
        { method: 'POST' as const, url: `/api/v1/imports/${jobId}/confirm` },
        { method: 'POST' as const, url: `/api/v1/imports/${jobId}/cancel` },
        { method: 'GET' as const, url: '/api/v1/import-mapping-templates' },
      ];
      for (const r of routes) {
        expectDenied(await c.inject({ method: r.method, url: r.url }), [401], `anonymous ${r.method} ${r.url}`);
        for (const [who, s] of [['no-permission', noPerm], ['seller', s1]] as const) {
          const res = await c.inject({ method: r.method, url: r.url, headers: r.method === 'GET' ? c.readHeaders(s) : c.writeHeaders(s) });
          expectDenied(res, [403], `${who} ${r.method} ${r.url}`);
        }
      }
      expectDenied(await upload(noPerm, [[asCode(`NOP-${uniq()}`), 'x', 1, 1, 1]]), [403], 'no-permission upload');
      const { body, contentType } = buildMultipartUpload({ filename: 'a.xlsx', contentType: XLSX_MIME, fileContent: await xlsx([]), fields: { columnMapping: MAPPING } });
      expectDenied(await c.inject({ method: 'POST', url: '/api/v1/imports', headers: { 'content-type': contentType }, body }), [401], 'anonymous upload');
      expect(await withDb(async (db) => (await db.select().from(schema.importJobs).where(eq(schema.importJobs.tenantId, A.tenantId))).length)).toBe(jobsBefore);
    });

    it('ISO-IMP-04 the downloadable TEMPLATE reflects only the caller\'s own warehouses/locations — never the other tenant\'s', async () => {
      const aTpl = await get(A.admin, '/api/v1/imports/template');
      const bTpl = await get(B.admin, '/api/v1/imports/template');
      expect(aTpl.statusCode).toBe(200);
      expect(bTpl.statusCode).toBe(200);
      const aText = await xlsxText(aTpl.rawPayload);
      const bText = await xlsxText(bTpl.rawPayload);
      expect(`${aText}`, 'positive control: A template names A\'s warehouse or location').toMatch(new RegExp(`${A.warehouseCode}|${A.locationCode}`.toLowerCase()));
      expectNoLeak(bText, [A.warehouseCode, A.locationCode], 'B import template');
      expectNoLeak(aText, [B.warehouseCode, B.locationCode], 'A import template');
    });

    it('ISO-IMP-05 upload tampering: foreign ids are refused (404/400) before anything is stored; steering fields and a traversal filename never cross tenants or escape storage', async () => {
      const jobsOf = (tenantId: string) => withDb(async (db) => (await db.select().from(schema.importJobs).where(eq(schema.importJobs.tenantId, tenantId))).length);
      const rowsFor = () => [[asCode('IMPT-' + uniq()), 'Tamper', 10, 9, 8]];

      // (1) another tenant's location / template ids, and malformed ids: refused, no job created in A or B.
      const bJobs = await jobsOf(B.tenantId);
      const aJobs = await jobsOf(A.tenantId);
      const tpl = await post(A.admin, '/api/v1/import-mapping-templates', { name: 'iso-imp05-' + uniq(), columnMapping: { Código: 'sku' } });
      const aTemplateId = json<{ id: string }>(tpl).id;
      for (const [label, fields, allowed] of [
        ['A default location id', { defaultLocationId: A.locationId }, [404]],
        ['A mapping template id', { mappingTemplateId: aTemplateId }, [404]],
        ['unknown default location id', { defaultLocationId: NIL }, [404]],
        ['malformed default location id', { defaultLocationId: 'not-a-uuid' }, [400]],
        ['malformed mapping template id', { mappingTemplateId: "'; drop table import_jobs;--" }, [400]],
      ] as const) {
        const res = await upload(B.admin, rowsFor(), { ...fields });
        expectDenied(res, [...allowed], 'B upload with ' + label);
        expectNoLeak(res.body, [A.locationCode, A.warehouseCode, A.tenantId], 'B upload with ' + label);
      }
      expect(await jobsOf(B.tenantId), 'a refused upload must not create a job').toBe(bJobs);
      expect(await jobsOf(A.tenantId)).toBe(aJobs);

      // (2) steering fields are ignored (not honoured) and a traversal filename is neutralised.
      const res = await upload(B.admin, rowsFor(), { tenantId: A.tenantId, createdBy: A.admin.user.id, status: 'completed' }, '../../../evil.xlsx');
      expect([201, 400, 422], res.body).toContain(res.statusCode);
      const created = await withDb(async (db) => await db.select().from(schema.importJobs).where(eq(schema.importJobs.originalFilename, '../../../evil.xlsx')));
      for (const j of created) {
        expect(j.tenantId, 'a steered upload must belong to the caller').toBe(B.tenantId);
        expect(j.createdBy).toBe(B.admin.user.id);
        expect(j.status).not.toBe('completed');
        expect(j.storageKey, 'storage key must not contain traversal').not.toMatch(/\.\./);
      }
      expect(created.every((j) => j.tenantId === B.tenantId)).toBe(true);

      // (3) own ids still work (positive control).
      const ok = await upload(B.admin, rowsFor(), { defaultLocationId: B.locationId });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(json<{ defaultLocationId?: string }>(ok).defaultLocationId).toBe(B.locationId);
    });

    it('ISO-IMP-06 mapping templates: B cannot read, change or delete A\'s template (404, still intact)', async () => {
      const name = `iso-tpl-${uniq()}`;
      const made = await post(A.admin, '/api/v1/import-mapping-templates', { name, columnMapping: { Código: 'sku' } });
      expect(made.statusCode, made.body).toBe(201);
      const id = json<{ id: string }>(made).id;
      expectDenied(await get(B.admin, `/api/v1/import-mapping-templates/${id}`), [404], 'B GET template');
      expectDenied(await c.inject({ method: 'PATCH', url: `/api/v1/import-mapping-templates/${id}`, headers: c.writeHeaders(B.admin), payload: { name: 'HACKED' } }), [404], 'B PATCH template');
      expectDenied(await c.inject({ method: 'DELETE', url: `/api/v1/import-mapping-templates/${id}`, headers: c.writeHeaders(B.admin) }), [404], 'B DELETE template');
      const still = await withDb(async (db) => (await db.select().from(schema.importMappingTemplates).where(eq(schema.importMappingTemplates.id, id)))[0]);
      expect(still?.name).toBe(name);
      expect(still, 'template must still exist').toBeDefined();
      expect(ids(await get(B.admin, '/api/v1/import-mapping-templates?pageSize=100'))).not.toContain(id);
    });
  });

  // ================================================================================================
  // Exports (orders, customers, transfers, payments, product catalog, Kardex)
  // ================================================================================================
  describe('exports', () => {
    let transferCode: string;
    let aCustomerTaxId: string;

    beforeAll(async () => {
      const cust = await get(A.admin, `/api/v1/customers/${A.customerId}`);
      aCustomerTaxId = json<{ taxId: string }>(cust).taxId;
      // A transfer in A so the transfers export has content (second location in A's warehouse).
      const dest = await c.createLocation(A.admin, A.warehouseId, asCode(`ISOD-${uniq()}`));
      const t = await post(A.admin, '/api/v1/inventory/transfers', { sourceLocationId: A.locationId, destinationLocationId: dest, items: [{ productVariantId: A.variantId, quantityRequested: 1 }] });
      expect(t.statusCode, t.body).toBe(201);
      transferCode = (json<{ code?: string }>(t).code ?? '').toString();
    }, 60_000);

    const cases = (): Array<{ id: string; name: string; url: string; aMarkers: string[]; foreignFilter: string; foreignCheck?: string[] }> => [
      { id: 'ISO-EXP-01', name: 'orders', url: '/api/v1/orders/export?format=xlsx', aMarkers: [A.customerMarker], foreignFilter: `&customerId=${A.customerId}` },
      { id: 'ISO-EXP-02', name: 'customers', url: '/api/v1/customers/export?format=xlsx', aMarkers: [A.customerMarker], foreignFilter: `&q=${A.customerMarker}`, foreignCheck: [aCustomerTaxId] },
      { id: 'ISO-EXP-03', name: 'transfers', url: '/api/v1/inventory/transfers/export?format=xlsx', aMarkers: [transferCode, `Loc ${A.locationCode}`].filter(Boolean), foreignFilter: `&sourceLocationId=${A.locationId}` },
      { id: 'ISO-EXP-04', name: 'payments', url: '/api/v1/reports/payments/export?format=xlsx&dateFrom=2020-01-01&dateTo=2100-12-31', aMarkers: [A.customerMarker], foreignFilter: `&locationId=${A.locationId}` },
      { id: 'ISO-EXP-05', name: 'product catalog', url: '/api/v1/reports/product-catalog/export?format=xlsx', aMarkers: [A.sku], foreignFilter: `&variantId=${A.variantId}` },
      { id: 'ISO-EXP-06', name: 'kardex', url: `/api/v1/reports/kardex/export?format=xlsx&productVariantId=${A.variantId}&locationId=${A.locationId}`, aMarkers: [A.sku], foreignFilter: '' },
    ];

    it('ISO-EXP-xx every export: A\'s own download has A\'s data (control), B\'s download has none of it, and A-derived filters from B return nothing foreign', async () => {
      // Make sure A has at least one payment/order so the sales exports are non-empty.
      const order = await placeOrder(A.admin, A, A.customerId);
      expect((await confirm(A.admin, order)).statusCode).toBe(200);

      for (const x of cases()) {
        const own = await get(A.admin, x.url);
        expect(own.statusCode, `${x.id} ${x.name} own -> ${own.body.slice(0, 120)}`).toBe(200);
        const ownText = await xlsxText(own.rawPayload);
        for (const m of x.aMarkers) expect(ownText, `${x.id} ${x.name}: positive control "${m}"`).toContain(m.toLowerCase());

        // B: kardex needs ids — B's own (so the call is legitimate); every other export is parameter-free.
        const bUrl = x.name === 'kardex' ? `/api/v1/reports/kardex/export?format=xlsx&productVariantId=${B.variantId}&locationId=${B.locationId}` : x.url;
        const bRes = await get(B.admin, bUrl);
        expect(bRes.statusCode, `${x.id} ${x.name} B -> ${bRes.body.slice(0, 120)}`).toBe(200);
        expectNoLeak(await xlsxText(bRes.rawPayload), [...x.aMarkers, A.customerMarker, c1.marker, c2.marker, A.warehouseCode, A.locationCode], `${x.id} ${x.name} B export`);

        if (x.foreignFilter) {
          const f = await get(B.admin, `${x.url}${x.foreignFilter}`);
          expect([200, 400, 403, 404], `${x.id} foreign filter -> ${f.body.slice(0, 120)}`).toContain(f.statusCode);
          if (f.statusCode === 200 && f.headers['content-type']?.toString().includes('spreadsheetml')) {
            expectNoLeak(await xlsxText(f.rawPayload), x.foreignCheck ?? x.aMarkers, `${x.id} ${x.name} B export with A filter`);
          }
        }

        expectDenied(await c.inject({ method: 'GET', url: x.url }), [401], `${x.id} anonymous`);
        expectDenied(await get(noPerm, x.url), [403], `${x.id} no-permission`);
      }
    }, 120_000);

    it('ISO-EXP-07 Kardex export with the OTHER tenant\'s variant/location is refused or empty — never A\'s data — and malformed/missing ids are 400', async () => {
      for (const [label, variantId, locationId] of [
        ['A variant @ A location', A.variantId, A.locationId],
        ['A variant @ B location', A.variantId, B.locationId],
        ['B variant @ A location', B.variantId, A.locationId],
      ] as const) {
        const res = await get(B.admin, `/api/v1/reports/kardex/export?format=xlsx&productVariantId=${variantId}&locationId=${locationId}`);
        expect([200, 400, 403, 404], `${label} -> ${res.body.slice(0, 120)}`).toContain(res.statusCode);
        if (res.statusCode === 200) expectNoLeak(await xlsxText(res.rawPayload), [A.sku, A.warehouseCode, A.locationCode], `kardex export ${label}`);
        else expectNoLeak(res.body, [A.sku, A.warehouseCode, A.locationCode], `kardex export ${label}`);
      }
      expectDenied(await get(B.admin, '/api/v1/reports/kardex/export?format=xlsx'), [400], 'kardex export without ids');
      expectDenied(await get(B.admin, '/api/v1/reports/kardex/export?format=xlsx&productVariantId=nope&locationId=nope'), [400], 'kardex export malformed ids');
    });
  });

  // ================================================================================================
  // Kardex + inventory movements
  // ================================================================================================
  describe('Kardex and inventory movements', () => {
    it('ISO-KRD-01 Kardex: own data for each tenant (control); the other tenant\'s variant/location is refused or empty, with no foreign names, costs or ids', async () => {
      const own = await get(A.admin, `/api/v1/reports/kardex?productVariantId=${A.variantId}&locationId=${A.locationId}`);
      expect(own.statusCode, own.body.slice(0, 200)).toBe(200);
      expect(own.body.length).toBeGreaterThan(50);

      for (const [label, variantId, locationId] of [
        ['B reads A variant @ A location', A.variantId, A.locationId],
        ['B reads A variant @ B location', A.variantId, B.locationId],
        ['B reads B variant @ A location', B.variantId, A.locationId],
      ] as const) {
        const res = await get(B.admin, `/api/v1/reports/kardex?productVariantId=${variantId}&locationId=${locationId}`);
        expect([200, 400, 403, 404], `${label} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
        // ids the caller itself supplied may legitimately be echoed back ("not found"); A's SKU, codes and tenant id may not.
        expectNoLeak(res.body, [A.sku, A.warehouseCode, A.locationCode, A.tenantId], label);
        if (res.statusCode === 200) {
          const data = json<{ movements?: unknown[]; rows?: unknown[]; data?: unknown[] }>(res);
          const list = data.movements ?? data.rows ?? data.data ?? [];
          expect(list, `${label}: a foreign Kardex must be empty`).toEqual([]);
        }
      }
    });

    it('ISO-KRD-02 movements list, balances and summaries never include the other tenant\'s rows, and A-derived filters from B return nothing', async () => {
      const aMovs = await get(A.admin, '/api/v1/inventory/movements?pageSize=100');
      expect(aMovs.statusCode).toBe(200);
      const aMovIds = ids(aMovs);
      expect(aMovIds.length).toBeGreaterThan(0);
      const bMovs = await get(B.admin, '/api/v1/inventory/movements?pageSize=100');
      expect(bMovs.statusCode).toBe(200);
      for (const id of aMovIds) expect(ids(bMovs)).not.toContain(id);
      expectNoLeak(bMovs.body, [A.sku, A.variantId, A.locationId, A.tenantId], 'B movements');

      for (const filter of [`productVariantId=${A.variantId}`, `locationId=${A.locationId}`, `productVariantId=${A.variantId}&locationId=${A.locationId}`]) {
        const res = await get(B.admin, `/api/v1/inventory/movements?pageSize=100&${filter}`);
        expect([200, 400, 403, 404], `${filter} -> ${res.body.slice(0, 120)}`).toContain(res.statusCode);
        if (res.statusCode === 200) expect(ids(res), `movements with A filter ${filter}`).toEqual([]);
      }
      const q = 'from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&groupBy=day';
      for (const url of [`/api/v1/reports/movements-summary?${q}&locationId=${A.locationId}`, `/api/v1/reports/movements-summary?${q}&productVariantId=${A.variantId}`, '/api/v1/reports/inventory-summary', `/api/v1/reports/inventory-summary?warehouseId=${A.warehouseId}`]) {
        const res = await get(B.admin, url);
        expect([200, 400, 403, 404], `${url} -> ${res.body.slice(0, 120)}`).toContain(res.statusCode);
        expectNoLeak(res.body, [A.sku, A.warehouseCode, A.locationCode, A.warehouseId, A.locationId], url);
      }
      const bal = await get(B.admin, `/api/v1/inventory/balances?productVariantId=${A.variantId}`);
      if (bal.statusCode === 200) expect(json<{ data: unknown[] }>(bal).data).toEqual([]);
    });

    it('ISO-KRD-03 stock WRITES across tenants are refused with no movement and no balance change (adjustments and transfers)', async () => {
      const mA = await movementCount(A.tenantId);
      const mB = await movementCount(B.tenantId);
      const stockA = await physicalAt(A.tenantId, A.variantId, A.locationId);
      const attempts: Array<[string, Record<string, unknown>]> = [
        ['B adjusts A variant at A location', { productVariantId: A.variantId, locationId: A.locationId, movementType: 'RECEIPT', quantity: 5, unitCost: 1, reason: 'x' }],
        ['B adjusts A variant at B location', { productVariantId: A.variantId, locationId: B.locationId, movementType: 'RECEIPT', quantity: 5, unitCost: 1, reason: 'x' }],
        ['B adjusts B variant at A location', { productVariantId: B.variantId, locationId: A.locationId, movementType: 'RECEIPT', quantity: 5, unitCost: 1, reason: 'x' }],
        ['B removes A stock', { productVariantId: A.variantId, locationId: A.locationId, movementType: 'ADJUSTMENT_OUT', quantity: 1, reason: 'x' }],
      ];
      for (const [label, payload] of attempts) expectDenied(await post(B.admin, '/api/v1/inventory/adjustments', payload), [404], label);
      const t1 = await post(B.admin, '/api/v1/inventory/transfers', { sourceLocationId: A.locationId, destinationLocationId: B.locationId, items: [{ productVariantId: A.variantId, quantityRequested: 1 }] });
      expectDenied(t1, [404, 403, 422], 'B transfer out of A location');
      const t2 = await post(B.admin, '/api/v1/inventory/transfers', { sourceLocationId: B.locationId, destinationLocationId: A.locationId, items: [{ productVariantId: B.variantId, quantityRequested: 1 }] });
      expectDenied(t2, [404, 403, 422], 'B transfer into A location');
      expect(await movementCount(A.tenantId)).toBe(mA);
      expect(await movementCount(B.tenantId)).toBe(mB);
      expect(await physicalAt(A.tenantId, A.variantId, A.locationId)).toBe(stockA);
    });

    it('ISO-KRD-04 authorization: anonymous 401; a role with no inventory permissions 403 on Kardex, movements and adjustments; cost fields are hidden without pricing.cost.view', async () => {
      const routes = [
        { method: 'GET' as const, url: `/api/v1/reports/kardex?productVariantId=${A.variantId}&locationId=${A.locationId}` },
        { method: 'GET' as const, url: '/api/v1/inventory/movements' },
        { method: 'GET' as const, url: '/api/v1/inventory/balances' },
        { method: 'POST' as const, url: '/api/v1/inventory/adjustments', payload: { productVariantId: A.variantId, locationId: A.locationId, movementType: 'ADJUSTMENT_OUT', quantity: 1, reason: 'x' } },
      ];
      const stock = await physicalAt(A.tenantId, A.variantId, A.locationId);
      for (const r of routes) {
        expectDenied(await c.inject({ method: r.method, url: r.url, ...('payload' in r ? { payload: r.payload } : {}) }), [401], `anonymous ${r.method} ${r.url}`);
        const res = await c.inject({ method: r.method, url: r.url, headers: r.method === 'GET' ? c.readHeaders(noPerm) : c.writeHeaders(noPerm), ...('payload' in r ? { payload: r.payload } : {}) });
        expectDenied(res, [403], `no-permission ${r.method} ${r.url}`);
      }
      // A seller holds inventory.view but not inventory.adjust, and no pricing.cost.view.
      expectDenied(await post(s1, '/api/v1/inventory/adjustments', routes[3]!.payload), [403], 'seller adjusting stock');
      expect(await physicalAt(A.tenantId, A.variantId, A.locationId)).toBe(stock);
      const sellerView = await get(s1, `/api/v1/reports/kardex?productVariantId=${A.variantId}&locationId=${A.locationId}`);
      expect(sellerView.statusCode, sellerView.body.slice(0, 160)).toBe(200);
      expect(sellerView.body, 'cost fields must be absent without pricing.cost.view').not.toMatch(/"(averageCost|unitCost|averageCostAfter|totalCost)"/);
      const adminView = await get(A.admin, `/api/v1/reports/kardex?productVariantId=${A.variantId}&locationId=${A.locationId}`);
      expect(adminView.body, 'positive control: the admin does see costs').toMatch(/"(averageCost|unitCost|averageCostAfter)"/);
    });
  });
});
