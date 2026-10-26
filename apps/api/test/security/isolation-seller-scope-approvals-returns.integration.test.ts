import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, expectNoLeak, uniq, withDb } from './iso-helpers';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * FASE 19 — seller-scope sweep for the two order-id WRITE routes the first isolation sweep left open:
 * `POST /price-approvals` (request an exceptional-discount approval for an order line) and
 * `POST /sales-returns` (register a return of a confirmed order). Follow-up to FINDING-VA-WRITE-SCOPE:
 * a seller without `sales.orders.view_all` cannot SEE another seller's order (404), so neither route may let
 * them act on it. Real `buildApp()` over HTTP, real PostgreSQL, one tenant with two sellers plus an
 * Administrador, a `view_all`-only role, a `view_all` + functional role, the default Supervisor, a
 * no-permission role and a second tenant. After EVERY refused attempt the database is read back: no
 * approval/return row, no change to the order line price/total, payments, stock, movements, outbox events or
 * audit rows. Case ids (ISO-APR / ISO-RET) are referenced by docs/security/tenant-isolation-http-matrix.md.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('seller scope on POST /price-approvals and POST /sales-returns (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  let admin: Session;
  let tenantId: string;
  let locationId: string;
  let variantId: string;
  let customerId: string;
  let owner: Session; // seller who places the orders under test
  let other: Session; // another seller of the SAME tenant, no view_all
  let viewAllOnly: Session; // view_all, but no pricing.discount.request / sales.returns.create
  let viewAllFn: Session; // Vendedor permissions + view_all
  let supervisor: Session; // the default Supervisor template
  let noPerm: Session;
  let foreignAdmin: Session; // another tenant
  let foreignLocationId: string;

  const SELLER_CODES = [...DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes];

  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');

  async function roleUser(roleName: string, codes: string[]): Promise<Session> {
    await c.createRole(admin, roleName, [...new Set(codes)]);
    const s = await c.createAndLoginAs(admin, `${stamp()}-${roleName.toLowerCase().replace(/\W+/g, '')}@example.com`, roleName);
    await c.setUserLocations(admin, s.user.id, [locationId]);
    return s;
  }

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);

    admin = await c.registerTenant(`Iso Seller Scope ${stamp()}`, `iso-ss-${stamp()}@example.com`);
    tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `ISOWS-${stamp()}`);
    locationId = await c.createLocation(admin, warehouseId, `ISOLS-${stamp()}`);
    ({ variantId } = await c.createProductVariant(admin, { sku: `ISOSS-${stamp()}`.toUpperCase(), maxPrice: 120, basePrice: 100, minPrice: 80 }));
    await c.receiveStock(admin, variantId, locationId, 500);
    customerId = await c.createCustomer(admin, c.fullCustomer(`isoss${stamp()}`));

    owner = await roleUser('Vendedor propietario', SELLER_CODES);
    other = await roleUser('Vendedor otro', SELLER_CODES);
    viewAllOnly = await roleUser('Solo vista total', ['sales.orders.view', 'sales.orders.view_all']);
    viewAllFn = await roleUser('Vendedor vista total', [...SELLER_CODES, 'sales.orders.view_all']);
    noPerm = await roleUser('Sin permisos', []);
    supervisor = await c.createAndLoginAs(admin, `${stamp()}-supervisor@example.com`, 'Supervisor');
    await c.setUserLocations(admin, supervisor.user.id, [locationId]);

    foreignAdmin = await c.registerTenant(`Iso Seller Scope X ${stamp()}`, `iso-ssx-${stamp()}@example.com`);
    const fw = await c.createWarehouse(foreignAdmin, `ISOWX-${stamp()}`);
    foreignLocationId = await c.createLocation(foreignAdmin, fw, `ISOLX-${stamp()}`);
  }, 240_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- HTTP helpers ----------------------------------------------------------------------------
  const post = (s: Session | undefined, url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    c.inject({ method: 'POST', url, headers: s ? c.writeHeaders(s, extra) : extra, ...(payload !== undefined ? { payload } : {}) });
  const get = (s: Session, url: string) => c.inject({ method: 'GET', url, headers: c.readHeaders(s) });
  const json = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;

  interface PlacedOrder {
    id: string;
    itemId: string;
    total: number;
  }
  async function placeOrder(s: Session, opts: { unitPrice?: number; quantity?: number } = {}): Promise<PlacedOrder> {
    const cart = await post(s, '/api/v1/cart', { locationId, customerId });
    expect([200, 201], cart.body).toContain(cart.statusCode);
    const item = await post(s, '/api/v1/cart/items', {
      productVariantId: variantId,
      quantity: opts.quantity ?? 1,
      ...(opts.unitPrice !== undefined ? { negotiatedUnitPrice: opts.unitPrice } : {}),
    });
    expect(item.statusCode, item.body).toBe(200);
    const order = await post(s, '/api/v1/orders', { cartId: json<{ id: string }>(cart).id, documentType: 'sales_note' }, { 'idempotency-key': randomUUID() });
    expect(order.statusCode, order.body).toBe(201);
    const body = json<{ id: string; total: number; items: Array<{ id: string }> }>(order);
    return { id: body.id, itemId: body.items[0]!.id, total: body.total };
  }
  const exceptionalOrder = (s: Session) => placeOrder(s, { unitPrice: 70 });
  async function confirmedOrder(s: Session, quantity = 5): Promise<PlacedOrder> {
    const o = await placeOrder(s, { quantity, unitPrice: 110 });
    const res = await post(s, `/api/v1/orders/${o.id}/confirm`, { payments: [{ paymentMethod: 'cash', amount: o.total }] });
    expect(res.statusCode, res.body).toBe(200);
    return o;
  }

  const requestApproval = (s: Session | undefined, payload: Record<string, unknown>) => post(s, '/api/v1/price-approvals', payload);
  const createReturn = (s: Session | undefined, payload: Record<string, unknown>, key: string | null = randomUUID()) =>
    post(s, '/api/v1/sales-returns', payload, key !== null ? { 'idempotency-key': key } : {});
  const returnPayload = (o: PlacedOrder, quantity = 1) => ({ orderId: o.id, locationId, reason: 'cliente devuelve el producto', items: [{ orderItemId: o.itemId, quantity }] });

  // ---- database read-back ----------------------------------------------------------------------
  const eventCount = (type: string) => withDb(async (db) => (await db.select().from(schema.eventOutbox).where(and(eq(schema.eventOutbox.tenantId, tenantId), eq(schema.eventOutbox.eventType, type)))).length);
  const auditCount = (code: string) => withDb(async (db) => (await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.actionCode, code)))).length);

  /** Everything a price-approval request could touch. */
  const approvalState = (o: PlacedOrder) =>
    withDb(async (db) => ({
      approvals: (await db.select().from(schema.priceApprovals).where(eq(schema.priceApprovals.orderId, o.id))).length,
      line: (await db.select({ unit: schema.orderItems.unitPriceSnapshot, total: schema.orderItems.lineTotal, discount: schema.orderItems.discountAmount, exceptional: schema.orderItems.isExceptionalDiscount }).from(schema.orderItems).where(eq(schema.orderItems.id, o.itemId)))[0],
      order: (await db.select({ total: schema.orders.total, status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, o.id)))[0],
      payments: (await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, o.id))).length,
      events: await eventCount('sales.price_approval.requested'),
      audit: await auditCount('price_approval.requested'),
    }));

  const physical = () =>
    withDb(async (db) => Number((await db.select({ q: schema.inventoryBalances.quantityPhysical }).from(schema.inventoryBalances).where(and(eq(schema.inventoryBalances.tenantId, tenantId), eq(schema.inventoryBalances.productVariantId, variantId), eq(schema.inventoryBalances.locationId, locationId))))[0]?.q ?? 0));
  /** Everything a sales-return creation could touch. */
  const returnState = (o: PlacedOrder) =>
    withDb(async (db) => {
      const returns = await db.select().from(schema.salesReturns).where(eq(schema.salesReturns.orderId, o.id));
      const ids = returns.map((r) => r.id);
      return {
        returns: returns.length,
        items: ids.length === 0 ? 0 : (await db.select().from(schema.salesReturnItems).where(inArray(schema.salesReturnItems.returnId, ids))).length,
        order: (await db.select({ status: schema.orders.status, total: schema.orders.total }).from(schema.orders).where(eq(schema.orders.id, o.id)))[0],
        payments: (await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, o.id))).length,
        returnMovements: (await db.select().from(schema.inventoryMovements).where(and(eq(schema.inventoryMovements.tenantId, tenantId), eq(schema.inventoryMovements.movementType, 'RETURN')))).length,
        stock: await physical(),
        events: await eventCount('sales.return.requested'),
        audit: await auditCount('sales_return.created'),
      };
    });

  // ================================================================================================
  // POST /price-approvals
  // ================================================================================================
  describe('POST /price-approvals — request an exceptional-discount approval', () => {
    it('ISO-APR-01 positive control: the OWNER requests approval for their own exceptional line (one row, one event, one audit)', async () => {
      const o = await exceptionalOrder(owner);
      const before = await approvalState(o);
      const res = await requestApproval(owner, { orderItemId: o.itemId, reason: 'cliente pide precio especial' });
      expect(res.statusCode, res.body).toBe(201);
      const after = await approvalState(o);
      expect(after.approvals).toBe(before.approvals + 1);
      expect(after.events).toBe(before.events + 1);
      expect(after.audit).toBe(before.audit + 1);
      const row = await withDb(async (db) => (await db.select().from(schema.priceApprovals).where(eq(schema.priceApprovals.orderId, o.id)))[0]);
      expect(row?.requestedBy).toBe(owner.user.id);
      expect(row?.status).toBe('pending');
    });

    it('ISO-APR-02 another seller WITHOUT view_all is refused (404, like a read) — including when trying to REWRITE the line price through newPrice', async () => {
      // one fresh order per attempt, so every refusal is evidenced independently of the others
      for (const extra of [{ newPrice: 95 }, { newPrice: 120 }, { requestedPrice: 70 }, {}]) {
        const o = await exceptionalOrder(owner);
        expect((await get(other, '/api/v1/orders/' + o.id)).statusCode, 'precondition: the order is invisible to them').toBe(404);
        const before = await approvalState(o);
        const res = await requestApproval(other, { orderItemId: o.itemId, reason: 'intento ajeno', ...extra });
        expectDenied(res, [404], 'other seller requesting ' + JSON.stringify(extra));
        expectNoLeak(res.body, [o.id, o.itemId.slice(0, 8)], 'refusal body');
        expect(await approvalState(o), 'a refused request must change NOTHING (rows, line price/total, events, audit) for ' + JSON.stringify(extra)).toEqual(before);
      }
    });

    it('ISO-APR-03 view_all alone grants no functional permission: without pricing.discount.request it is 403 and nothing changes', async () => {
      const o = await exceptionalOrder(owner);
      const before = await approvalState(o);
      expectDenied(await requestApproval(viewAllOnly, { orderItemId: o.itemId, reason: 'solo ver' }), [403], 'view_all without request permission');
      expect(await approvalState(o)).toEqual(before);
    });

    it('ISO-APR-04 positive controls: view_all + the functional permission, and the Administrador, CAN request on another seller\'s line', async () => {
      const o1 = await exceptionalOrder(owner);
      expect((await requestApproval(viewAllFn, { orderItemId: o1.itemId, reason: 'supervisión con vista total' })).statusCode).toBe(201);
      const o2 = await exceptionalOrder(owner);
      expect((await requestApproval(admin, { orderItemId: o2.itemId, reason: 'administrador' })).statusCode).toBe(201);
    });

    it('ISO-APR-05 the default Supervisor follows its template: no request permission → 403; and never reaches another seller\'s line without view_all', async () => {
      const o = await exceptionalOrder(owner);
      const before = await approvalState(o);
      const holdsRequest = DEFAULT_ROLE_TEMPLATES.Supervisor.permissionCodes.includes('pricing.discount.request');
      expectDenied(await requestApproval(supervisor, { orderItemId: o.itemId, reason: 'supervisor' }), holdsRequest ? [404] : [403], 'default Supervisor');
      expect(await approvalState(o)).toEqual(before);
    });

    it('ISO-APR-06 foreign, unknown, malformed and tampered input: 404 / 400, no side effect', async () => {
      const o = await exceptionalOrder(owner);
      const before = await approvalState(o);
      expectDenied(await requestApproval(owner, { orderItemId: NIL, reason: 'motivo de prueba' }), [404], 'unknown line');
      expectDenied(await requestApproval(owner, { orderItemId: 'not-a-uuid', reason: 'motivo de prueba' }), [400], 'malformed line id');
      expectDenied(await requestApproval(foreignAdmin, { orderItemId: o.itemId, reason: 'otro tenant' }), [404], 'other TENANT requesting');
      for (const tamper of [{ orderId: o.id }, { requestedBy: admin.user.id }, { tenantId: tenantId }, { status: 'approved' }, { approvedBy: admin.user.id }]) {
        expectDenied(await requestApproval(owner, { orderItemId: o.itemId, reason: 'x', ...tamper }), [400], 'tamper ' + JSON.stringify(tamper));
      }
      expectDenied(await requestApproval(owner, { orderItemId: o.itemId }), [400], 'missing reason');
      expect(await approvalState(o)).toEqual(before);
    });

    it('ISO-APR-07 order states that do not admit a request: confirmed/cancelled order 409, non-exceptional line 422, duplicate pending 409 — no new rows', async () => {
      const confirmed = await confirmedOrder(owner, 1);
      const cancelledSrc = await exceptionalOrder(owner);
      expect((await post(owner, `/api/v1/orders/${cancelledSrc.id}/cancel`)).statusCode).toBe(200);
      const normal = await placeOrder(owner, { unitPrice: 110 });
      const live = await exceptionalOrder(owner);
      expect((await requestApproval(owner, { orderItemId: live.itemId, reason: 'primera' })).statusCode).toBe(201);

      const before = await Promise.all([confirmed, cancelledSrc, normal, live].map(approvalState));
      expectDenied(await requestApproval(owner, { orderItemId: confirmed.itemId, reason: 'motivo de prueba' }), [409], 'confirmed order');
      expectDenied(await requestApproval(owner, { orderItemId: cancelledSrc.itemId, reason: 'motivo de prueba' }), [409], 'cancelled order');
      expectDenied(await requestApproval(owner, { orderItemId: normal.itemId, reason: 'motivo de prueba' }), [422], 'line inside the authorized range');
      expectDenied(await requestApproval(owner, { orderItemId: live.itemId, reason: 'segunda' }), [409], 'duplicate pending request');
      expect(await Promise.all([confirmed, cancelledSrc, normal, live].map(approvalState))).toEqual(before);
    });

    it('ISO-APR-08 races: two concurrent requests by the owner → exactly one 201 and one 409 (one row, one event); owner || other seller → 201 and 404', async () => {
      const o = await exceptionalOrder(owner);
      const before = await approvalState(o);
      const [r1, r2] = await Promise.all([requestApproval(owner, { orderItemId: o.itemId, reason: 'motivo uno' }), requestApproval(owner, { orderItemId: o.itemId, reason: 'motivo dos' })]);
      expect([r1.statusCode, r2.statusCode].sort(), r1.body + r2.body).toEqual([201, 409]);
      const mid = await approvalState(o);
      expect(mid.approvals).toBe(before.approvals + 1);
      expect(mid.events).toBe(before.events + 1);
      expect(mid.audit).toBe(before.audit + 1);

      const o2 = await exceptionalOrder(owner);
      const b2 = await approvalState(o2);
      const [ro, rx] = await Promise.all([requestApproval(owner, { orderItemId: o2.itemId, reason: 'dueño' }), requestApproval(other, { orderItemId: o2.itemId, reason: 'ajeno', newPrice: 90 })]);
      expect([ro.statusCode, rx.statusCode], ro.body + rx.body).toEqual([201, 404]);
      const a2 = await approvalState(o2);
      expect(a2.approvals).toBe(b2.approvals + 1);
      expect(a2.line, 'the foreign newPrice must not have altered the line').toEqual(b2.line);
    });

    it('ISO-APR-09 anonymous is 401 and a role with no permissions is 403', async () => {
      const o = await exceptionalOrder(owner);
      const before = await approvalState(o);
      expectDenied(await requestApproval(undefined, { orderItemId: o.itemId, reason: 'motivo de prueba' }), [401], 'anonymous');
      expectDenied(await requestApproval(noPerm, { orderItemId: o.itemId, reason: 'motivo de prueba' }), [403], 'no permission');
      expect(await approvalState(o)).toEqual(before);
    });

    it('ISO-APR-10 approver capabilities are unchanged: the Administrador approves the owner\'s request; a seller cannot approve or reject', async () => {
      const o = await exceptionalOrder(owner);
      const made = await requestApproval(owner, { orderItemId: o.itemId, reason: 'para aprobar' });
      const id = json<{ id: string }>(made).id;
      expectDenied(await post(other, `/api/v1/price-approvals/${id}/approve`), [403], 'seller approving');
      expectDenied(await post(owner, `/api/v1/price-approvals/${id}/reject`), [403], 'seller rejecting');
      expect((await post(admin, `/api/v1/price-approvals/${id}/approve`)).statusCode).toBe(200);
      const confirm = await post(owner, `/api/v1/orders/${o.id}/confirm`, { payments: [{ paymentMethod: 'cash', amount: o.total }] });
      expect(confirm.statusCode, confirm.body).toBe(200);
    });

  });

  // ================================================================================================
  // POST /sales-returns
  // ================================================================================================
  describe('POST /sales-returns — register a return of a confirmed order', () => {
    it('ISO-RET-01 positive control: the OWNER registers a return for their own confirmed order (one return, one item, one event, one audit; stock untouched until resolve)', async () => {
      const o = await confirmedOrder(owner);
      const before = await returnState(o);
      const res = await createReturn(owner, returnPayload(o, 2));
      expect(res.statusCode, res.body).toBe(201);
      const after = await returnState(o);
      expect(after.returns).toBe(before.returns + 1);
      expect(after.items).toBe(before.items + 1);
      expect(after.events).toBe(before.events + 1);
      expect(after.audit).toBe(before.audit + 1);
      expect(after.stock, 'a requested return moves no stock').toBe(before.stock);
      expect(after.returnMovements).toBe(before.returnMovements);
    });

    it('ISO-RET-02 another seller WITHOUT view_all is refused (404): no return, no item, no movement, no stock/payment change, no event, no audit', async () => {
      const o = await confirmedOrder(owner);
      expect((await get(other, `/api/v1/orders/${o.id}`)).statusCode, 'precondition: invisible order').toBe(404);
      const before = await returnState(o);
      const res = await createReturn(other, returnPayload(o));
      expectDenied(res, [404], 'other seller creating a return');
      expectNoLeak(res.body, [o.id, o.itemId.slice(0, 8)], 'refusal body');
      expect(await returnState(o)).toEqual(before);
    });

    it('ISO-RET-03 view_all alone grants no functional permission: without sales.returns.create it is 403, nothing changes', async () => {
      const o = await confirmedOrder(owner);
      const before = await returnState(o);
      expectDenied(await createReturn(viewAllOnly, returnPayload(o)), [403], 'view_all without returns permission');
      expect(await returnState(o)).toEqual(before);
    });

    it('ISO-RET-04 positive controls: view_all + the functional permission, and the Administrador, CAN register a return for another seller\'s order', async () => {
      const o = await confirmedOrder(owner);
      expect((await createReturn(viewAllFn, returnPayload(o))).statusCode).toBe(201);
      expect((await createReturn(admin, returnPayload(o))).statusCode).toBe(201);
    });

    it('ISO-RET-05 the default Supervisor (sales.returns.create, no view_all) cannot register a return for another seller\'s order (404)', async () => {
      const o = await confirmedOrder(owner);
      const before = await returnState(o);
      const holdsCreate = DEFAULT_ROLE_TEMPLATES.Supervisor.permissionCodes.includes('sales.returns.create');
      expectDenied(await createReturn(supervisor, returnPayload(o)), holdsCreate ? [404] : [403], 'default Supervisor');
      expect(await returnState(o)).toEqual(before);
    });

    it('ISO-RET-06 foreign, unknown, malformed and tampered input, and states that do not admit a return: 404 / 400 / 409 / 422, no side effect', async () => {
      const o = await confirmedOrder(owner, 3);
      const otherOrder = await confirmedOrder(owner, 3);
      const pending = await placeOrder(owner, { unitPrice: 110 });
      const cancelled = await placeOrder(owner, { unitPrice: 110 });
      expect((await post(owner, `/api/v1/orders/${cancelled.id}/cancel`)).statusCode).toBe(200);
      const all = [o, otherOrder, pending, cancelled];
      const before = await Promise.all(all.map(returnState));

      expectDenied(await createReturn(owner, { ...returnPayload(o), orderId: NIL }), [404], 'unknown order');
      expectDenied(await createReturn(owner, { ...returnPayload(o), orderId: 'not-a-uuid' }), [400], 'malformed order id');
      expectDenied(await createReturn(foreignAdmin, returnPayload(o)), [404], 'other TENANT');
      expectDenied(await createReturn(owner, { ...returnPayload(o), locationId: foreignLocationId }), [404], 'other tenant\'s receiving location');
      expectDenied(await createReturn(owner, { ...returnPayload(o), locationId: NIL }), [404], 'unknown receiving location');
      expectDenied(await createReturn(owner, { ...returnPayload(o), items: [{ orderItemId: otherOrder.itemId, quantity: 1 }] }), [422], 'line of ANOTHER order');
      expectDenied(await createReturn(owner, returnPayload(o, 99)), [409], 'more than sold');
      expectDenied(await createReturn(owner, returnPayload(pending)), [409], 'pending order');
      expectDenied(await createReturn(owner, returnPayload(cancelled)), [409], 'cancelled order');
      for (const tamper of [{ requestedBy: admin.user.id }, { tenantId }, { status: 'resolved' }, { returnNumber: 'DEV-9999' }]) {
        expectDenied(await createReturn(owner, { ...returnPayload(o), ...tamper }), [400], 'tamper ' + JSON.stringify(tamper));
      }
      expectDenied(await createReturn(owner, returnPayload(o), null), [400], 'missing Idempotency-Key');
      expectDenied(await createReturn(owner, { ...returnPayload(o), reason: 'x' }), [400], 'too-short reason');
      expectDenied(await createReturn(owner, { ...returnPayload(o), items: [] }), [400], 'no items');
      expectDenied(await createReturn(owner, { ...returnPayload(o), items: [{ orderItemId: o.itemId, quantity: -1 }] }), [400], 'negative quantity');
      expect(await Promise.all(all.map(returnState))).toEqual(before);
    });

    it('ISO-RET-07 idempotency: the owner\'s replay returns the same return (no second row); the same key with a different payload is 409; ANOTHER seller replaying the owner\'s key gets nothing of the owner\'s return', async () => {
      const o = await confirmedOrder(owner, 4);
      const key = randomUUID();
      const first = await createReturn(owner, returnPayload(o, 1), key);
      expect(first.statusCode, first.body).toBe(201);
      const firstId = json<{ id: string }>(first).id;
      const before = await returnState(o);

      const replay = await createReturn(owner, returnPayload(o, 1), key);
      expect([200, 201], replay.body).toContain(replay.statusCode);
      expect(json<{ id: string }>(replay).id).toBe(firstId);
      expectDenied(await createReturn(owner, returnPayload(o, 2), key), [409], 'same key, different payload');

      const stolen = await createReturn(other, returnPayload(o, 1), key);
      expect(stolen.statusCode, 'another seller must not replay the owner\'s stored response: ' + stolen.body.slice(0, 160)).not.toBe(200);
      expect(stolen.statusCode).not.toBe(201);
      expectNoLeak(stolen.body, [firstId, o.id], 'replay by another seller');
      expect(await returnState(o)).toEqual(before);
    });

    it('ISO-RET-08 races: same key twice → one return; two over-returning requests → one 201 and one 409 (never more than sold); owner || other seller → 201 and 404', async () => {
      const a = await confirmedOrder(owner, 4);
      const key = randomUUID();
      const [s1, s2] = await Promise.all([createReturn(owner, returnPayload(a, 1), key), createReturn(owner, returnPayload(a, 1), key)]);
      expect([s1.statusCode, s2.statusCode].every((s) => s === 200 || s === 201), s1.body + s2.body).toBe(true);
      expect((await returnState(a)).returns, 'the same key must create ONE return').toBe(1);

      const b = await confirmedOrder(owner, 4);
      const [r1, r2] = await Promise.all([createReturn(owner, returnPayload(b, 3)), createReturn(owner, returnPayload(b, 3))]);
      expect([r1.statusCode, r2.statusCode].sort(), r1.body + r2.body).toEqual([201, 409]);
      expect((await returnState(b)).returns).toBe(1);

      const d = await confirmedOrder(owner, 4);
      const before = await returnState(d);
      const [ro, rx] = await Promise.all([createReturn(owner, returnPayload(d, 1)), createReturn(other, returnPayload(d, 1))]);
      expect([ro.statusCode, rx.statusCode], ro.body + rx.body).toEqual([201, 404]);
      const after = await returnState(d);
      expect(after.returns).toBe(before.returns + 1);
      expect(after.events).toBe(before.events + 1);
    });

    it('ISO-RET-09 anonymous is 401 and a role with no permissions is 403', async () => {
      const o = await confirmedOrder(owner);
      const before = await returnState(o);
      expectDenied(await createReturn(undefined, returnPayload(o)), [401], 'anonymous');
      expectDenied(await createReturn(noPerm, returnPayload(o)), [403], 'no permission');
      expect(await returnState(o)).toEqual(before);
    });

    it('ISO-RET-10 downstream capabilities are unchanged: the Administrador inspects and resolves the owner\'s return, writing ONE RETURN movement that restocks', async () => {
      const o = await confirmedOrder(owner, 2);
      const made = await createReturn(owner, returnPayload(o, 2));
      expect(made.statusCode, made.body).toBe(201);
      const ret = json<{ id: string; items: Array<{ id: string }> }>(made);
      const stockBefore = await physical();
      const inspected = await post(admin, `/api/v1/sales-returns/${ret.id}/inspect`, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'restock', dispositionLocationId: locationId }] });
      expect(inspected.statusCode, inspected.body).toBe(200);
      const resolved = await post(admin, `/api/v1/sales-returns/${ret.id}/resolve`, undefined, { 'idempotency-key': randomUUID() });
      expect(resolved.statusCode, resolved.body).toBe(200);
      expect(await physical()).toBe(stockBefore + 2);
    });

    it('ISO-RET-11 CANCEL honours the same rule: another seller without view_all cannot cancel the owner\'s return (404), the owner can', async () => {
      const o = await confirmedOrder(owner, 2);
      const made = await createReturn(owner, returnPayload(o, 1));
      const id = json<{ id: string }>(made).id;
      const before = await returnState(o);
      const res = await post(other, `/api/v1/sales-returns/${id}/cancel`);
      expectDenied(res, [403, 404], 'other seller cancelling the owner\'s return');
      const status = await withDb(async (db) => (await db.select({ s: schema.salesReturns.status }).from(schema.salesReturns).where(eq(schema.salesReturns.id, id)))[0]?.s);
      expect(status, 'the return must still be requested').toBe('requested');
      expect(await returnState(o)).toEqual(before);
      expect((await post(owner, `/api/v1/sales-returns/${id}/cancel`)).statusCode).toBe(200);
    });
  });
});
