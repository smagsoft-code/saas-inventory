import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { PlatformAuditLogService } from '../../src/common/audit/platform-audit-log.service';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, makePlatformClient, pdfText, uniq, withDb, xlsxText } from './iso-helpers';

const READ = 'support.tenant_read';

/**
 * FASE 19 — SUP-READ-NOT-AUDITED, the part the first pass left unverified: the xlsx / pdf DOWNLOADS read under a support session, and the
 * fail-closed rule forced over real HTTP (the earlier evidence for it was a unit spec only).
 *
 * Exports are `GET`s handled with `@Res({ passthrough: true })` returning a Buffer, so they go through the same global interceptor as any
 * read. This file proves it per route instead of assuming it, and proves the file is not delivered when the audit row cannot be written.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('support read audit — downloads and fail-closed over HTTP (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let p: ReturnType<typeof makePlatformClient>;

  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');
  let admin: Session;
  let tenantId = '';
  let locA = '';
  let variantId = '';
  let customerMarker = '';
  let warehouseId = '';
  let orderNumber = '';
  let orderId = '';

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    p = makePlatformClient(app);

    admin = await c.registerTenant(`Iso SupExp ${stamp()}`, `iso-supexp-${stamp()}@example.com`);
    tenantId = admin.user.tenantId;
    warehouseId = await c.createWarehouse(admin, `ISOSW-${stamp()}`);
    locA = await c.createLocation(admin, warehouseId, `ISOSA-${stamp()}`);
    const locB = await c.createLocation(admin, warehouseId, `ISOSB-${stamp()}`);
    ({ variantId } = await c.createProductVariant(admin, { sku: `ISOS-${stamp()}`.toUpperCase(), maxPrice: 120, basePrice: 100, minPrice: 80 }));
    await c.receiveStock(admin, variantId, locA, 100);
    customerMarker = `isosupcust${stamp()}`;
    const customerId = await c.createCustomer(admin, c.fullCustomer(customerMarker));
    const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(admin), payload: { locationId: locA, customerId } });
    expect([200, 201]).toContain(cart.statusCode);
    expect((await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(admin), payload: { productVariantId: variantId, quantity: 2, negotiatedUnitPrice: 110 } })).statusCode).toBe(200);
    const order = await c.inject({ method: 'POST', url: '/api/v1/orders', headers: c.writeHeaders(admin, { 'idempotency-key': randomUUID() }), payload: { cartId: JSON.parse(cart.body).id, documentType: 'sales_note' } });
    expect(order.statusCode, order.body).toBe(201);
    const body = JSON.parse(order.body) as { id: string; total: number; orderNumber: string };
    orderNumber = body.orderNumber;
    orderId = body.id;
    expect((await c.inject({ method: 'POST', url: `/api/v1/orders/${body.id}/confirm`, headers: c.writeHeaders(admin), payload: { payments: [{ paymentMethod: 'cash', amount: body.total }] } })).statusCode).toBe(200);
    const tr = await c.inject({ method: 'POST', url: '/api/v1/inventory/transfers', headers: c.writeHeaders(admin), payload: { sourceLocationId: locA, destinationLocationId: locB, items: [{ productVariantId: variantId, quantityRequested: 1 }] } });
    expect(tr.statusCode, tr.body).toBe(201);
  }, 240_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
  });

  const startSession = async (s: Awaited<ReturnType<typeof p.newAdmin>>): Promise<string> => {
    const res = await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/support-sessions`, headers: p.headers(s), payload: { mode: 'read', reason: 'ISO-SUP-20 downloads' } });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  };
  const end = (s: Awaited<ReturnType<typeof p.newAdmin>>) => p.inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: p.headers(s) });
  const rowsOf = (adminId: string) =>
    withDb((db) => db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, adminId), eq(schema.auditLog.actionCode, READ))));
  const state = (r: { afterState: unknown }) => r.afterState as { route: string; outcome: string; statusCode: number };

  const exportsUnderTest = () => [
    { name: 'orders', url: '/api/v1/orders/export?format=xlsx', route: '/api/v1/orders/export', marker: customerMarker },
    { name: 'customers', url: '/api/v1/customers/export?format=xlsx', route: '/api/v1/customers/export', marker: customerMarker },
    { name: 'transfers', url: '/api/v1/inventory/transfers/export?format=xlsx', route: '/api/v1/inventory/transfers/export', marker: undefined },
    { name: 'payments', url: '/api/v1/reports/payments/export?format=xlsx&dateFrom=2020-01-01&dateTo=2100-12-31', route: '/api/v1/reports/payments/export', marker: customerMarker },
    { name: 'product catalog', url: '/api/v1/reports/product-catalog/export?format=xlsx', route: '/api/v1/reports/product-catalog/export', marker: undefined },
    { name: 'kardex', url: `/api/v1/reports/kardex/export?format=xlsx&productVariantId=${variantId}&locationId=${locA}`, route: '/api/v1/reports/kardex/export', marker: undefined },
  ];

  it('ISO-SUP-20 every download served under a support session is audited once, with its real outcome — the file is the same one the route serves, and a route that refuses a support principal is audited as refused', async () => {
    const sup = await p.newAdmin();
    const sessionId = await startSession(sup);
    const observed: Record<string, { status: number; rows: number; outcome: string | undefined }> = {};
    for (const x of exportsUnderTest()) {
      const before = (await rowsOf(sup.admin.id)).length;
      const res = await p.inject({ method: 'GET', url: x.url, headers: p.headers(sup) });
      const after = await rowsOf(sup.admin.id);
      const mine = after.filter((r) => state(r).route === x.route);
      observed[x.name] = { status: res.statusCode, rows: after.length - before, outcome: mine.length ? state(mine[mine.length - 1]!).outcome : undefined };
      if (res.statusCode === 200) {
        expect(String(res.headers['content-type']), `${x.name} content type`).toContain('spreadsheetml');
        const text = await xlsxText(res.rawPayload);
        expect(text.length, `${x.name}: a real workbook`).toBeGreaterThan(0);
        if (x.marker) expect(text.includes(x.marker), `${x.name}: the file carries the tenant's data (control)`).toBe(true);
      }
    }
    // pdf variant of one export: same flow, readable text
    const before = (await rowsOf(sup.admin.id)).length;
    const pdf = await p.inject({ method: 'GET', url: '/api/v1/inventory/transfers/export?format=pdf', headers: p.headers(sup) });
    expect(pdf.statusCode, pdf.body.slice(0, 200)).toBe(200);
    expect(pdfText(pdf.rawPayload)).toContain('transferencia');
    expect((await rowsOf(sup.admin.id)).length - before, 'the pdf download is one audited read').toBe(1);

    // every request that reached a handler left exactly one row, and its outcome matches the HTTP status
    for (const [name, o] of Object.entries(observed)) {
      expect(o.rows, `${name}: one audit row per download (status ${o.status})`).toBe(1);
      expect(o.outcome, `${name}: outcome matches status ${o.status}`).toBe(o.status === 200 ? 'success' : o.status === 401 || o.status === 403 ? 'denied' : o.status === 404 ? 'not_found' : o.status >= 500 ? 'error' : 'rejected');
    }
    // Observed contract (ADR-0036): the orders and payments exports are keyed off the acting USER (seller scope), which a support principal does not have,
    // so they refuse it with 401 — the refusal is audited as 'denied', and no workbook is produced.
    expect(Object.fromEntries(Object.entries(observed).map(([k, v]) => [k, v.status]))).toEqual({ orders: 401, customers: 200, transfers: 200, payments: 401, 'product catalog': 200, kardex: 200 });
    const rows = await rowsOf(sup.admin.id);
    expect(rows.every((r) => r.tenantId === tenantId && r.entityId === sessionId && r.actorType === 'platform_admin')).toBe(true);
    await end(sup);
  });

  it('ISO-SUP-22 the inventory ledger stays readable under a support session (movements, Kardex json and export): rows and stock arithmetic are served, the commercial references are masked — a support principal is not a seller with sales.orders.view_all', async () => {
    const sup = await p.newAdmin();
    await startSession(sup);
    const movements = await p.inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}&pageSize=50`, headers: p.headers(sup) });
    expect(movements.statusCode, movements.body.slice(0, 200)).toBe(200);
    const rows = (JSON.parse(movements.body) as { data: Array<{ movementType: string; quantity: number; balanceAfter: number; referenceId?: string; reason?: string; actorId?: string; referenceLabel?: string }> }).data;
    const sale = rows.find((r) => r.movementType === 'SALE');
    expect(sale, 'the SALE row is served (stock truth)').toBeDefined();
    expect(sale!.quantity, 'the sale of 2 units, signed as an outflow').toBe(-2);
    expect(sale!.referenceLabel, 'generic label, no number').toBe('Venta');
    expect(sale!.referenceId).toBeUndefined();
    expect(sale!.actorId).toBeUndefined();
    expect(movements.body.includes(orderNumber) || movements.body.includes(orderId), 'the order reference is masked from support').toBe(false);

    const kardex = await p.inject({ method: 'GET', url: `/api/v1/reports/kardex?productVariantId=${variantId}&locationId=${locA}`, headers: p.headers(sup) });
    expect(kardex.statusCode, kardex.body.slice(0, 200)).toBe(200);
    expect(kardex.body.includes(orderNumber), 'Kardex json: order number masked').toBe(false);
    const xlsx = await p.inject({ method: 'GET', url: `/api/v1/reports/kardex/export?format=xlsx&productVariantId=${variantId}&locationId=${locA}`, headers: p.headers(sup) });
    expect(xlsx.statusCode, xlsx.body.slice(0, 200)).toBe(200);
    expect((await xlsxText(xlsx.rawPayload)).includes(orderNumber.toLowerCase()), 'Kardex xlsx: order number masked').toBe(false);
    // all three were audited as successful support reads
    const audited = (await rowsOf(sup.admin.id)).map((r) => [state(r).route, state(r).outcome]);
    expect(audited).toEqual([['/api/v1/inventory/movements', 'success'], ['/api/v1/reports/kardex', 'success'], ['/api/v1/reports/kardex/export', 'success']]);
    await end(sup);
  });

  it('ISO-SUP-21 FAIL-CLOSED over HTTP: when the audit row cannot be written, the read — JSON or download — is NOT delivered; one attempt, a clean error, no data in it; reads resume when the audit works again', async () => {
    const sup = await p.newAdmin();
    await startSession(sup);
    const original = PlatformAuditLogService.prototype.record;
    const spy = vi.spyOn(PlatformAuditLogService.prototype, 'record').mockImplementation(function (this: PlatformAuditLogService, entry) {
      if (entry.actionCode === READ) return Promise.reject(new Error('simulated audit outage'));
      return original.call(this, entry);
    });
    try {
      const attemptsBefore = spy.mock.calls.filter(([e]) => e.actionCode === READ).length;
      for (const [label, url] of [['customers list', '/api/v1/customers?pageSize=5'], ['customers xlsx', '/api/v1/customers/export?format=xlsx'], ['catalog xlsx', '/api/v1/reports/product-catalog/export?format=xlsx']] as const) {
        const res = await p.inject({ method: 'GET', url, headers: p.headers(sup) });
        expect(res.statusCode, `${label}: refused while the audit is down`).toBe(500);
        expect(res.body.includes(customerMarker), `${label}: the body carries no tenant data`).toBe(false);
        expect(res.body.toLowerCase().includes('simulated audit outage'), `${label}: the internal cause is not echoed`).toBe(false);
        expect(String(res.headers['content-type'] ?? ''), `${label}: no workbook is sent`).not.toContain('spreadsheetml');
      }
      const attempts = spy.mock.calls.filter(([e]) => e.actionCode === READ).length - attemptsBefore;
      expect(attempts, 'exactly one write attempt per refused read').toBe(3);
    // (a download that the route itself refuses with 401 still reaches the interceptor and is audited — covered by ISO-SUP-20)
      expect(await rowsOf(sup.admin.id), 'nothing was recorded while the audit was down').toHaveLength(0);
      // the outage is not a bypass for the guards: a refused verb and a tenant without a session are still refused
      expectDenied(await p.inject({ method: 'POST', url: '/api/v1/customers', headers: p.headers(sup), payload: { type: 'pasaporte', firstName: 'X', lastName: 'Y', taxId: 'ZZ' + stamp() } }), [403], 'write verb');
    } finally {
      spy.mockRestore();
    }
    // audit restored → the same read works and is recorded
    const ok = await p.inject({ method: 'GET', url: '/api/v1/customers?pageSize=5', headers: p.headers(sup) });
    expect(ok.statusCode, ok.body.slice(0, 200)).toBe(200);
    expect(ok.body.includes(customerMarker)).toBe(true);
    expect(await rowsOf(sup.admin.id)).toHaveLength(1);
    await end(sup);
  });
});
