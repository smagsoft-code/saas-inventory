import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { PlatformAuditLogService } from '../../src/common/audit/platform-audit-log.service';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, makePlatformClient, pdfText, uniq, withDb, type PlatformSession } from './iso-helpers';

const READ = 'support.tenant_read';

/**
 * FASE 19 — the Kardex PDF download under a support session, over real HTTP. Until now the PDF under support was verified by reading the code only
 * (it is built from the same `getKardex` data as the JSON and the xlsx). This reads the PDF TEXT of the real response and proves, with positive
 * controls, that the commercial references are masked: the same download made by the tenant's own Administrador DOES contain the order number, so the
 * extractor can see it, and the support download does not.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('support session — Kardex PDF download (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let p: ReturnType<typeof makePlatformClient>;

  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');
  interface Tenant {
    admin: Session;
    tenantId: string;
    locationId: string;
    variantId: string;
    sku: string;
    orderNumber: string;
    orderId: string;
  }
  let A: Tenant;
  let B: Tenant;

  async function seedTenant(label: string, orders: number): Promise<Tenant> {
    const admin = await c.registerTenant(`Iso KPdf ${label} ${stamp()}`, `iso-kpdf-${label.toLowerCase()}-${stamp()}@example.com`);
    const warehouseId = await c.createWarehouse(admin, `ISOKW${label}-${stamp()}`);
    const locationId = await c.createLocation(admin, warehouseId, `ISOKL${label}-${stamp()}`);
    const sku = `ISOK${label}-${stamp()}`.toUpperCase();
    const { variantId } = await c.createProductVariant(admin, { sku, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, locationId, 100);
    const customerId = await c.createCustomer(admin, c.fullCustomer(`isokp${stamp()}`));
    let last = { id: '', orderNumber: '' };
    for (let n = 0; n < orders; n += 1) {
      const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(admin), payload: { locationId, customerId } });
      expect([200, 201]).toContain(cart.statusCode);
      expect((await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(admin), payload: { productVariantId: variantId, quantity: 2 + n, negotiatedUnitPrice: 110 } })).statusCode).toBe(200);
      const order = await c.inject({ method: 'POST', url: '/api/v1/orders', headers: c.writeHeaders(admin, { 'idempotency-key': randomUUID() }), payload: { cartId: JSON.parse(cart.body).id, documentType: 'sales_note' } });
      expect(order.statusCode, order.body).toBe(201);
      const body = JSON.parse(order.body) as { id: string; total: number; orderNumber: string };
      expect((await c.inject({ method: 'POST', url: `/api/v1/orders/${body.id}/confirm`, headers: c.writeHeaders(admin), payload: { payments: [{ paymentMethod: 'cash', amount: body.total }] } })).statusCode).toBe(200);
      last = { id: body.id, orderNumber: body.orderNumber };
    }
    return { admin, tenantId: admin.user.tenantId, locationId, variantId, sku, orderNumber: last.orderNumber, orderId: last.id };
  }

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    p = makePlatformClient(app);
    A = await seedTenant('A', 1);
    B = await seedTenant('B', 2);
  }, 240_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
  });

  const pdfUrl = (t: Tenant) => `/api/v1/reports/kardex/export?format=pdf&productVariantId=${t.variantId}&locationId=${t.locationId}`;
  const start = async (s: PlatformSession, mode: 'read' | 'write' = 'read'): Promise<string> => {
    const res = await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${A.tenantId}/support-sessions`, headers: p.headers(s), payload: { mode, reason: 'ISO-SUP-29 kardex pdf' } });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  };
  const end = (s: PlatformSession) => p.inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: p.headers(s) });
  const rows = (adminId: string) => withDb((db) => db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, adminId), eq(schema.auditLog.actionCode, READ))));
  const state = (r: { afterState: unknown }) => r.afterState as { route: string; outcome: string; statusCode: number };

  /** A response that is really a PDF: status, type, disposition, %PDF header, %%EOF trailer, a body of real size — not a JSON error dressed as one. */
  const expectRealPdf = (res: LightMyRequestResponse, label: string): string => {
    expect(res.statusCode, `${label}: ${res.body.slice(0, 160)}`).toBe(200);
    expect(String(res.headers['content-type']), `${label}: content type`).toContain('application/pdf');
    expect(String(res.headers['content-disposition']), `${label}: disposition`).toMatch(/attachment; filename="[^"]+\.pdf"/);
    const raw = res.rawPayload;
    expect(raw.subarray(0, 5).toString('latin1'), `${label}: PDF header`).toBe('%PDF-');
    expect(raw.subarray(Math.max(0, raw.length - 16)).toString('latin1'), `${label}: PDF trailer`).toContain('%%EOF');
    expect(raw.length, `${label}: a body of real size`).toBeGreaterThan(1000);
    const text = pdfText(raw);
    expect(text, `${label}: readable Kardex text`).toContain('kardex');
    return text;
  };
  const expectNotAPdf = (res: LightMyRequestResponse, label: string): void => {
    expect(String(res.headers['content-type'] ?? ''), `${label}: no PDF content type`).not.toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString('latin1'), `${label}: no PDF bytes`).not.toBe('%PDF');
  };

  it('ISO-SUP-29 a support session downloads a REAL Kardex PDF whose text keeps the stock arithmetic and masks every commercial reference (positive control: the tenant\'s own Administrador sees the order number in the same PDF)', async () => {
    const own = await c.inject({ method: 'GET', url: pdfUrl(A), headers: c.readHeaders(A.admin) });
    const ownText = expectRealPdf(own, 'tenant Administrador');
    expect(ownText, 'control: the order number IS in the tenant\'s own PDF').toContain(A.orderNumber.toLowerCase());
    expect(ownText).toContain(A.sku.toLowerCase());

    for (const mode of ['read', 'write'] as const) {
      const sup = await p.newAdmin();
      const sessionId = await start(sup, mode);
      const res = await p.inject({ method: 'GET', url: pdfUrl(A), headers: p.headers(sup) });
      const text = expectRealPdf(res, `support (${mode} session)`);
      // the diagnostic content stays: the SKU, the sale row with its generic label and the stock figures
      expect(text).toContain(A.sku.toLowerCase());
      expect(text, 'a generic sale label is drawn').toContain('venta');
      expect(text, 'the opening stock row is drawn').toContain('100');
      // every commercial reference is gone: the number, the uuid, who rang the sale up
      expect(text.includes(A.orderNumber.toLowerCase()), `${mode}: the order number is in the support PDF`).toBe(false);
      expect(text.includes('ord-'), `${mode}: any order-number prefix in the support PDF`).toBe(false);
      expect(text.includes(A.orderId.toLowerCase()), `${mode}: the order uuid`).toBe(false);
      expect(text.includes(A.admin.user.id.toLowerCase()), `${mode}: the tenant user id`).toBe(false);
      expect(res.rawPayload.toString('latin1').includes(A.orderId), `${mode}: the order uuid anywhere in the raw bytes`).toBe(false);
      // nothing of the other tenant
      expect(text.includes(B.sku.toLowerCase()), `${mode}: tenant B's SKU`).toBe(false);
      expect(text.includes(B.orderNumber.toLowerCase()) && B.orderNumber !== A.orderNumber, `${mode}: tenant B's order number`).toBe(false);
      // exactly one audited read for the download, on the session's tenant, naming the platform admin
      const audited = await rows(sup.admin.id);
      expect(audited.map((r) => [state(r).route, state(r).outcome, state(r).statusCode])).toEqual([['/api/v1/reports/kardex/export', 'success', 200]]);
      expect(audited[0]!.tenantId).toBe(A.tenantId);
      expect(audited[0]!.entityId).toBe(sessionId);
      expect(audited[0]!.actorType).toBe('platform_admin');
      await end(sup);
    }
  });

  it('ISO-SUP-30 tenant and session boundaries: another tenant\'s variant/location yields an EMPTY PDF indistinguishable from an unknown id (nothing of B), and no session / an ended or expired session / anonymous get no PDF and no audit row', async () => {
    const bControl = await c.inject({ method: 'GET', url: pdfUrl(B), headers: c.readHeaders(B.admin) });
    const bText = expectRealPdf(bControl, 'tenant B Administrador');
    expect(bText, 'control: tenant B\'s own PDF carries its SKU').toContain(B.sku.toLowerCase());

    const sup = await p.newAdmin();
    // no session at all
    const none = await p.inject({ method: 'GET', url: pdfUrl(A), headers: p.headers(sup) });
    expectDenied(none, [401, 403], 'platform admin without a session');
    expectNotAPdf(none, 'no session');
    expect(none.body.toLowerCase().includes(A.sku.toLowerCase()), 'the refusal carries no tenant data').toBe(false);

    const sessionId = await start(sup);
    // A session on A cannot download B's Kardex. Observed contract (the same as the xlsx, ISO-EXP-07): the ids are not found under A's tenant, so the answer is an
    // EMPTY placeholder PDF ("Producto ()", no rows) — and it must be indistinguishable from the answer for an id that exists nowhere, so it cannot confirm that B owns it.
    const normalise = (text: string): string => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'ID').replace(/generado:[^\n]*/g, 'generado:');
    const nowhere = randomUUID();
    const unknown = await p.inject({ method: 'GET', url: `/api/v1/reports/kardex/export?format=pdf&productVariantId=${nowhere}&locationId=${nowhere}`, headers: p.headers(sup) });
    const unknownText = normalise(expectRealPdf(unknown, 'unknown ids'));
    for (const [label, url] of [
      ['B variant @ B location', pdfUrl(B)],
      ['B variant @ A location', `/api/v1/reports/kardex/export?format=pdf&productVariantId=${B.variantId}&locationId=${A.locationId}`],
    ] as const) {
      const res = await p.inject({ method: 'GET', url, headers: p.headers(sup) });
      const text = normalise(expectRealPdf(res, label));
      expect(text, `${label}: identical to the answer for an id that exists nowhere`).toBe(unknownText);
      expect(text.includes(B.sku.toLowerCase()), `${label}: tenant B's SKU`).toBe(false);
      expect(text.includes('venta'), `${label}: no sale row`).toBe(false);
      expect(res.rawPayload.toString('latin1').includes(B.tenantId), `${label}: tenant B's id in the bytes`).toBe(false);
    }
    // A's variant at B's location: A's own variant, a location A does not have — no B data either way
    const mixed = await p.inject({ method: 'GET', url: `/api/v1/reports/kardex/export?format=pdf&productVariantId=${A.variantId}&locationId=${B.locationId}`, headers: p.headers(sup) });
    expect([200, 400, 403, 404], `A variant @ B location -> ${mixed.statusCode}`).toContain(mixed.statusCode);
    if (mixed.statusCode === 200) {
      const text = pdfText(mixed.rawPayload);
      expect(text.includes(B.sku.toLowerCase()) || text.includes('venta'), 'A variant @ B location: no B data and no sale rows').toBe(false);
    }
    // malformed ids
    expectDenied(await p.inject({ method: 'GET', url: '/api/v1/reports/kardex/export?format=pdf&productVariantId=nope&locationId=nope', headers: p.headers(sup) }), [400], 'malformed ids');
    // every attempt is an audited read of the session tenant (A) — the empty ones are 200 reads of nothing, the malformed one is a rejection; none is attributed to B
    const attempts = (await rows(sup.admin.id)).filter((r) => state(r).route === '/api/v1/reports/kardex/export');
    expect(attempts.length).toBe(5);
    expect(attempts.every((r) => r.tenantId === A.tenantId && r.entityId === sessionId)).toBe(true);
    expect(attempts.filter((r) => state(r).outcome === 'rejected')).toHaveLength(1);

    // expire the session in the database: the PDF is refused again, with no new row
    const countBeforeExpiry = (await rows(sup.admin.id)).length;
    await withDb((db) => db.update(schema.platformSupportSessions).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.platformSupportSessions.id, sessionId)));
    const expired = await p.inject({ method: 'GET', url: pdfUrl(A), headers: p.headers(sup) });
    expectDenied(expired, [401, 403], 'expired session');
    expectNotAPdf(expired, 'expired session');
    expect((await rows(sup.admin.id)).length, 'an expired session reads nothing and audits nothing').toBe(countBeforeExpiry);

    // ended session
    const sup2 = await p.newAdmin();
    await start(sup2);
    await end(sup2);
    const ended = await p.inject({ method: 'GET', url: pdfUrl(A), headers: p.headers(sup2) });
    expectDenied(ended, [401, 403], 'ended session');
    expectNotAPdf(ended, 'ended session');
    expect(await rows(sup2.admin.id)).toHaveLength(0);

    // anonymous
    expectDenied(await p.inject({ method: 'GET', url: pdfUrl(A) }), [401], 'anonymous');
    // the audit rows (sup) all belong to A, none to B
    expect((await withDb((db) => db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, B.tenantId), eq(schema.auditLog.actionCode, READ))))).length).toBe(0);
  });

  it('ISO-SUP-31 FAIL-CLOSED: when the support read row cannot be written the PDF is NOT delivered — a clean 500, no PDF bytes, no tenant data, no cause — and the download works again once the audit is restored', async () => {
    const sup = await p.newAdmin();
    await start(sup);
    const original = PlatformAuditLogService.prototype.record;
    const spy = vi.spyOn(PlatformAuditLogService.prototype, 'record').mockImplementation(function (this: PlatformAuditLogService, entry) {
      if (entry.actionCode === READ) return Promise.reject(new Error('simulated audit outage'));
      return original.call(this, entry);
    });
    try {
      const attemptsBefore = spy.mock.calls.filter(([e]) => e.actionCode === READ).length;
      const res = await p.inject({ method: 'GET', url: pdfUrl(A), headers: p.headers(sup) });
      expect(res.statusCode, 'refused while the audit is down').toBe(500);
      expectNotAPdf(res, 'audit outage');
      expect(res.rawPayload.length, 'a small JSON error, not a document').toBeLessThan(1000);
      for (const secret of [A.sku, A.orderNumber, A.orderId, 'simulated audit outage', 'kardex']) {
        expect(res.body.toLowerCase().includes(secret.toLowerCase()), `the error body leaks "${secret.slice(0, 14)}"`).toBe(false);
      }
      expect(spy.mock.calls.filter(([e]) => e.actionCode === READ).length - attemptsBefore, 'exactly one write attempt').toBe(1);
      expect(await rows(sup.admin.id), 'nothing recorded while the audit is down').toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
    const restored = await p.inject({ method: 'GET', url: pdfUrl(A), headers: p.headers(sup) });
    const text = expectRealPdf(restored, 'audit restored');
    expect(text.includes(A.orderNumber.toLowerCase()), 'still masked after the outage').toBe(false);
    expect(await rows(sup.admin.id)).toHaveLength(1);
    await end(sup);
  });
});
