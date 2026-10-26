import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, expectNoLeak, uniq, withDb } from './iso-helpers';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * FASE 19 — owner decision on the READ scope of price approvals and sales returns, and the cross-seller attack matrix on the
 * approver (`approve` / `reject`) and warehouse (`inspect` / `resolve`) routes.
 *
 * Reads (decision 2026-10-26): a seller without `sales.orders.view_all` reads only the requests / returns of the orders THEY
 * placed — lists (totals included), lookups by id and the returns-summary aggregate alike. Approvers (`pricing.discount.approve`)
 * keep the whole approvals queue; the warehouse (`inventory.returns.manage`) keeps every return; `view_all` widens both reads but
 * grants no action. A hidden resource answers exactly like a missing one.
 *
 * Workflows: `approve`/`reject` and `inspect`/`resolve` are gated by their FUNCTIONAL permission (and the location scope for the
 * warehouse), not by who placed the order — approvers and warehouse staff act across sellers by design; sellers, `view_all` alone
 * and other tenants cannot. After every refusal the database is read back (status, dispositions, prices, totals, payments, stock,
 * movements, outbox events, audit) — the HTTP code alone is never the evidence.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('seller scope — approvals/returns reads and approver/warehouse workflows (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  let admin: Session;
  let tenantId: string;
  let locationId: string;
  let variantId: string;
  let customerId: string;
  let owner: Session;
  let other: Session;
  let viewAllOnly: Session; // view_all + sales.returns.view, but no pricing.discount.request / approve, no returns.manage
  let viewAllFn: Session; // Vendedor permissions + view_all
  let sellerApprover: Session; // Vendedor permissions + pricing.discount.approve (a seller who is also an approver)
  let supervisor: Session; // default template
  let bodega: Session; // default template, location assigned
  let bodegaNoLocation: Session; // default template, NO location assignment
  let noPerm: Session;
  let foreignAdmin: Session;

  const SELLER_CODES = [...DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes];
  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');

  async function roleUser(roleName: string, codes: string[], withLocation = true): Promise<Session> {
    await c.createRole(admin, roleName, [...new Set(codes)]);
    const s = await c.createAndLoginAs(admin, `${stamp()}-${roleName.toLowerCase().replace(/\W+/g, '')}@example.com`, roleName);
    if (withLocation) await c.setUserLocations(admin, s.user.id, [locationId]);
    return s;
  }

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);

    admin = await c.registerTenant(`Iso Read Scope ${stamp()}`, `iso-rs-${stamp()}@example.com`);
    tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `ISOWR-${stamp()}`);
    locationId = await c.createLocation(admin, warehouseId, `ISOLR-${stamp()}`);
    ({ variantId } = await c.createProductVariant(admin, { sku: `ISORS-${stamp()}`.toUpperCase(), maxPrice: 120, basePrice: 100, minPrice: 80 }));
    await c.receiveStock(admin, variantId, locationId, 1000);
    customerId = await c.createCustomer(admin, c.fullCustomer(`isors${stamp()}`));

    owner = await roleUser('Vendedor propietario', SELLER_CODES);
    other = await roleUser('Vendedor otro', SELLER_CODES);
    viewAllOnly = await roleUser('Solo vista total', ['sales.orders.view', 'sales.orders.view_all', 'sales.returns.view']);
    viewAllFn = await roleUser('Vendedor vista total', [...SELLER_CODES, 'sales.orders.view_all']);
    sellerApprover = await roleUser('Vendedor aprobador', [...SELLER_CODES, 'pricing.discount.approve']);
    noPerm = await roleUser('Sin permisos', []);
    supervisor = await c.createAndLoginAs(admin, `${stamp()}-supervisor@example.com`, 'Supervisor');
    await c.setUserLocations(admin, supervisor.user.id, [locationId]);
    bodega = await c.createAndLoginAs(admin, `${stamp()}-bodega@example.com`, 'Bodega');
    await c.setUserLocations(admin, bodega.user.id, [locationId]);
    bodegaNoLocation = await c.createAndLoginAs(admin, `${stamp()}-bodega2@example.com`, 'Bodega');

    foreignAdmin = await c.registerTenant(`Iso Read Scope X ${stamp()}`, `iso-rsx-${stamp()}@example.com`);
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- HTTP helpers ---------------------------------------------------------------------------------
  const post = (s: Session | undefined, url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    c.inject({ method: 'POST', url, headers: s ? c.writeHeaders(s, extra) : extra, ...(payload !== undefined ? { payload } : {}) });
  const get = (s: Session, url: string) => c.inject({ method: 'GET', url, headers: c.readHeaders(s) });
  const json = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;
  /** The body with the per-request correlation id removed, to compare a hidden resource with a missing one. */
  const normalized = (res: LightMyRequestResponse): string => {
    const body = JSON.parse(res.body) as Record<string, unknown>;
    delete body['correlationId'];
    return JSON.stringify(body);
  };
  const listIds = async (s: Session, url: string): Promise<{ ids: string[]; total: number; status: number }> => {
    const res = await get(s, url);
    if (res.statusCode !== 200) return { ids: [], total: -1, status: res.statusCode };
    const body = json<{ data: Array<{ id: string }>; meta: { total: number } }>(res);
    return { ids: body.data.map((r) => r.id), total: body.meta.total, status: 200 };
  };

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
  async function confirmedOrder(s: Session, quantity = 5): Promise<PlacedOrder> {
    const o = await placeOrder(s, { quantity, unitPrice: 110 });
    const res = await post(s, `/api/v1/orders/${o.id}/confirm`, { payments: [{ paymentMethod: 'cash', amount: o.total }] });
    expect(res.statusCode, res.body).toBe(200);
    return o;
  }
  /** A pending approval request on the seller's own exceptional order. */
  async function approvalRequest(s: Session): Promise<{ order: PlacedOrder; id: string }> {
    const order = await placeOrder(s, { unitPrice: 70 });
    const res = await post(s, '/api/v1/price-approvals', { orderItemId: order.itemId, reason: 'cliente pide precio especial' });
    expect(res.statusCode, res.body).toBe(201);
    return { order, id: json<{ id: string }>(res).id };
  }
  /** A `requested` return of the seller's own confirmed order. */
  async function returnRequest(s: Session, quantity = 2): Promise<{ order: PlacedOrder; id: string; itemId: string; quantity: number }> {
    const order = await confirmedOrder(s, 5);
    const res = await post(s, '/api/v1/sales-returns', { orderId: order.id, locationId, reason: 'cliente devuelve el producto', items: [{ orderItemId: order.itemId, quantity }] }, { 'idempotency-key': randomUUID() });
    expect(res.statusCode, res.body).toBe(201);
    const body = json<{ id: string; items: Array<{ id: string }> }>(res);
    return { order, id: body.id, itemId: body.items[0]!.id, quantity };
  }

  // ---- database read-back --------------------------------------------------------------------------
  const events = (type: string) => withDb(async (db) => (await db.select().from(schema.eventOutbox).where(and(eq(schema.eventOutbox.tenantId, tenantId), eq(schema.eventOutbox.eventType, type)))).length);
  const audits = (code: string) => withDb(async (db) => (await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.actionCode, code)))).length);
  const physical = () =>
    withDb(async (db) => Number((await db.select({ q: schema.inventoryBalances.quantityPhysical }).from(schema.inventoryBalances).where(and(eq(schema.inventoryBalances.tenantId, tenantId), eq(schema.inventoryBalances.productVariantId, variantId), eq(schema.inventoryBalances.locationId, locationId))))[0]?.q ?? 0));
  const returnMovements = () => withDb(async (db) => (await db.select().from(schema.inventoryMovements).where(and(eq(schema.inventoryMovements.tenantId, tenantId), eq(schema.inventoryMovements.movementType, 'RETURN')))).length);

  const approvalState = (a: { id: string; order: PlacedOrder }) =>
    withDb(async (db) => ({
      row: (await db.select({ status: schema.priceApprovals.status, approvedBy: schema.priceApprovals.approvedBy, resolvedAt: schema.priceApprovals.resolvedAt }).from(schema.priceApprovals).where(eq(schema.priceApprovals.id, a.id)))[0],
      line: (await db.select({ unit: schema.orderItems.unitPriceSnapshot, total: schema.orderItems.lineTotal, discount: schema.orderItems.discountAmount }).from(schema.orderItems).where(eq(schema.orderItems.id, a.order.itemId)))[0],
      order: (await db.select({ total: schema.orders.total, status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, a.order.id)))[0],
      payments: (await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, a.order.id))).length,
      approved: await events('sales.price_approval.approved'),
      rejected: await events('sales.price_approval.rejected'),
      auditApproved: await audits('price_approval.approved'),
      auditRejected: await audits('price_approval.rejected'),
    }));

  const returnState = (r: { id: string; order: PlacedOrder }) =>
    withDb(async (db) => ({
      row: (await db.select({ status: schema.salesReturns.status, receivedBy: schema.salesReturns.receivedBy }).from(schema.salesReturns).where(eq(schema.salesReturns.id, r.id)))[0],
      items: (await db.select({ disposition: schema.salesReturnItems.disposition, location: schema.salesReturnItems.dispositionLocationId }).from(schema.salesReturnItems).where(eq(schema.salesReturnItems.returnId, r.id))),
      orderStatus: (await db.select({ s: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, r.order.id)))[0]?.s,
      payments: (await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, r.order.id))).length,
      movements: await returnMovements(),
      stock: await physical(),
      resolved: await events('sales.return.resolved'),
      auditInspected: await audits('sales_return.inspected'),
      auditResolved: await audits('sales_return.resolved'),
    }));

  const inspectPayload = (r: { itemId: string }) => ({ items: [{ returnItemId: r.itemId, disposition: 'restock', dispositionLocationId: locationId }] });
  const inspect = (s: Session | undefined, r: { id: string; itemId: string }, payload: unknown = inspectPayload(r)) => post(s, `/api/v1/sales-returns/${r.id}/inspect`, payload);
  const resolve = (s: Session | undefined, id: string, key: string | null = randomUUID()) => post(s, `/api/v1/sales-returns/${id}/resolve`, undefined, key !== null ? { 'idempotency-key': key } : {});

  // ================================================================================================
  // READS — price approvals
  // ================================================================================================
  describe('reads — price approvals', () => {
    let mine: { order: PlacedOrder; id: string }; // owner's request
    let theirs: { order: PlacedOrder; id: string }; // the other seller's request
    const url = '/api/v1/price-approvals?pageSize=100';

    beforeAll(async () => {
      mine = await approvalRequest(owner);
      theirs = await approvalRequest(other);
    }, 120_000);

    it('ISO-APR-11 a seller sees ONLY the requests on their own orders — in the list (totals included) and by id; a hidden request is indistinguishable from a missing one', async () => {
      const ownerList = await listIds(owner, url);
      expect(ownerList.status).toBe(200);
      expect(ownerList.ids).toContain(mine.id);
      expect(ownerList.ids).not.toContain(theirs.id);
      expect(ownerList.total, 'the list total must not count requests the caller cannot see').toBe(ownerList.ids.length);
      expect((await get(owner, `/api/v1/price-approvals/${mine.id}`)).statusCode).toBe(200);

      const otherList = await listIds(other, url);
      expect(otherList.ids).toContain(theirs.id);
      expect(otherList.ids).not.toContain(mine.id);
      expect(otherList.total).toBe(otherList.ids.length);

      const hidden = await get(other, `/api/v1/price-approvals/${mine.id}`);
      expectDenied(hidden, [404], 'other seller reading the owner\'s request by id');
      const missing = await get(other, `/api/v1/price-approvals/${NIL}`);
      expect(normalized(hidden), 'a hidden request must answer exactly like a missing one').toBe(normalized(missing));
      expectNoLeak(hidden.body, [mine.id, mine.order.id], 'hidden request body');

      // filters cannot widen the scope
      for (const q of [`&orderId=${mine.order.id}`, '&status=pending', `&orderId=${mine.order.id}&status=pending`]) {
        const filtered = await listIds(other, url + q);
        expect(filtered.ids, 'filter ' + q).not.toContain(mine.id);
        expect(filtered.total, 'filter ' + q).toBe(filtered.ids.length);
      }
    });

    it('ISO-APR-12 approvers keep the whole queue (Supervisor, Administrador, a seller who is also an approver) and view_all widens it; view_all alone is 403 (it grants no read of the queue by itself)', async () => {
      for (const [label, s] of [['Supervisor', supervisor], ['Administrador', admin], ['seller + approver', sellerApprover], ['Vendedor + view_all', viewAllFn]] as const) {
        const list = await listIds(s, url);
        expect(list.status, label).toBe(200);
        expect(list.ids, label).toEqual(expect.arrayContaining([mine.id, theirs.id]));
        expect((await get(s, `/api/v1/price-approvals/${mine.id}`)).statusCode, label + ' by id').toBe(200);
      }
      // no request/approve permission → the queue itself is closed, regardless of view_all
      expectDenied(await get(viewAllOnly, url), [403], 'view_all without request/approve');
      expectDenied(await get(viewAllOnly, `/api/v1/price-approvals/${mine.id}`), [403], 'view_all without request/approve by id');
      expectDenied(await get(noPerm, url), [403], 'no permission');
      expectDenied(await c.inject({ method: 'GET', url }), [401], 'anonymous');
    });

    it('ISO-APR-13 list and by-id agree for every viewer (no request is listed yet 404, or retrievable yet unlisted), and another tenant sees nothing', async () => {
      for (const [label, s] of [['owner', owner], ['other', other], ['supervisor', supervisor], ['viewAllFn', viewAllFn], ['admin', admin]] as const) {
        const list = await listIds(s, url);
        for (const id of [mine.id, theirs.id]) {
          const byId = await get(s, `/api/v1/price-approvals/${id}`);
          expect(byId.statusCode === 200, `${label}: ${id} listed=${list.ids.includes(id)} byId=${byId.statusCode}`).toBe(list.ids.includes(id));
        }
      }
      const foreign = await listIds(foreignAdmin, url);
      expect(foreign.ids).not.toEqual(expect.arrayContaining([mine.id]));
      expectDenied(await get(foreignAdmin, `/api/v1/price-approvals/${mine.id}`), [404], 'other tenant reading by id');
    });

    it('ISO-APR-14 the approvals report stays approver-only: a seller is 403 on it (no aggregate path around the list scope)', async () => {
      const q = '/api/v1/reports/approvals-summary?groupBy=status&from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z';
      expectDenied(await get(owner, q), [403], 'seller on the approvals report');
      expect((await get(supervisor, q)).statusCode).toBe(200);
    });
  });

  // ================================================================================================
  // READS — sales returns
  // ================================================================================================
  describe('reads — sales returns', () => {
    let mine: { order: PlacedOrder; id: string };
    let theirs: { order: PlacedOrder; id: string };
    const url = '/api/v1/sales-returns?pageSize=100';

    beforeAll(async () => {
      mine = await returnRequest(owner);
      theirs = await returnRequest(other);
    }, 120_000);

    it('ISO-RET-12 a seller sees ONLY the returns of their own orders — in the list (totals included) and by id; a hidden return is indistinguishable from a missing one', async () => {
      const ownerList = await listIds(owner, url);
      expect(ownerList.status).toBe(200);
      expect(ownerList.ids).toContain(mine.id);
      expect(ownerList.ids).not.toContain(theirs.id);
      expect(ownerList.total).toBe(ownerList.ids.length);
      expect((await get(owner, `/api/v1/sales-returns/${mine.id}`)).statusCode).toBe(200);

      const otherList = await listIds(other, url);
      expect(otherList.ids).toContain(theirs.id);
      expect(otherList.ids).not.toContain(mine.id);

      const hidden = await get(other, `/api/v1/sales-returns/${mine.id}`);
      expectDenied(hidden, [404], 'other seller reading the owner\'s return by id');
      const missing = await get(other, `/api/v1/sales-returns/${NIL}`);
      expect(normalized(hidden), 'a hidden return must answer exactly like a missing one').toBe(normalized(missing));
      expectNoLeak(hidden.body, [mine.id, mine.order.id], 'hidden return body');

      for (const q of [`&orderId=${mine.order.id}`, '&status=requested', `&orderId=${mine.order.id}&status=requested`]) {
        const filtered = await listIds(other, url + q);
        expect(filtered.ids, 'filter ' + q).not.toContain(mine.id);
        expect(filtered.total, 'filter ' + q).toBe(filtered.ids.length);
      }
    });

    it('ISO-RET-13 view_all and the warehouse keep reading every return (Administrador, Supervisor, Bodega with its location, Vendedor + view_all); view_all without sales.returns.view, no permission and anonymous are refused', async () => {
      for (const [label, s] of [['Administrador', admin], ['Supervisor', supervisor], ['Bodega', bodega], ['Vendedor + view_all', viewAllFn]] as const) {
        const list = await listIds(s, url);
        expect(list.status, label).toBe(200);
        expect(list.ids, label).toEqual(expect.arrayContaining([mine.id, theirs.id]));
        expect((await get(s, `/api/v1/sales-returns/${mine.id}`)).statusCode, label + ' by id').toBe(200);
      }
      // the view_all-only role holds sales.returns.view, so it reads (that is exactly what view_all widens)…
      expect((await get(viewAllOnly, `/api/v1/sales-returns/${mine.id}`)).statusCode).toBe(200);
      // …but a role WITHOUT sales.returns.view is refused whatever else it holds, and so are no-permission / anonymous callers
      expectDenied(await get(noPerm, url), [403], 'no permission');
      expectDenied(await c.inject({ method: 'GET', url }), [401], 'anonymous');
    });

    it('ISO-RET-14 the warehouse is bounded by its LOCATION scope: a Bodega with no location assignment sees nothing (list empty, by id 404)', async () => {
      const list = await listIds(bodegaNoLocation, url);
      expect(list.status === 200 ? list.ids : []).toEqual([]);
      expectDenied(await get(bodegaNoLocation, `/api/v1/sales-returns/${mine.id}`), [404], 'unassigned Bodega by id');
    });

    it('ISO-RET-15 list and by-id agree for every viewer, and another tenant sees nothing', async () => {
      for (const [label, s] of [['owner', owner], ['other', other], ['bodega', bodega], ['supervisor', supervisor], ['viewAllFn', viewAllFn], ['admin', admin]] as const) {
        const list = await listIds(s, url);
        for (const id of [mine.id, theirs.id]) {
          const byId = await get(s, `/api/v1/sales-returns/${id}`);
          expect(byId.statusCode === 200, `${label}: ${id} listed=${list.ids.includes(id)} byId=${byId.statusCode}`).toBe(list.ids.includes(id));
        }
      }
      expect((await listIds(foreignAdmin, url)).ids).not.toContain(mine.id);
      expectDenied(await get(foreignAdmin, `/api/v1/sales-returns/${mine.id}`), [404], 'other tenant reading by id');
    });

    it('ISO-RET-16 the returns-summary aggregate carries the SAME scope — it must not reveal what the list hides', async () => {
      const q = '/api/v1/reports/returns-summary?groupBy=day&status=requested&from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z';
      const count = async (s: Session): Promise<number> => {
        const res = await get(s, q);
        expect(res.statusCode, res.body).toBe(200);
        return json<{ buckets: Array<{ returnCount: number }> }>(res).buckets.reduce((n, b) => n + b.returnCount, 0);
      };
      const truth = await withDb(async (db) => {
        const rows = await db
          .select({ id: schema.salesReturns.id, placedBy: schema.orders.placedByUserId })
          .from(schema.salesReturns)
          .innerJoin(schema.orders, eq(schema.orders.id, schema.salesReturns.orderId))
          .where(and(eq(schema.salesReturns.tenantId, tenantId), eq(schema.salesReturns.status, 'requested')));
        return { all: rows.length, ownerOwn: rows.filter((r) => r.placedBy === owner.user.id).length, otherOwn: rows.filter((r) => r.placedBy === other.user.id).length };
      });
      expect(truth.ownerOwn).toBeGreaterThan(0);
      expect(truth.all).toBeGreaterThan(truth.ownerOwn);
      expect(await count(owner), 'seller aggregates only own returns').toBe(truth.ownerOwn);
      expect(await count(other)).toBe(truth.otherOwn);
      expect(await count(admin), 'Administrador aggregates all').toBe(truth.all);
      expect(await count(bodega), 'warehouse aggregates all').toBe(truth.all);
      expect(await count(viewAllFn), 'view_all aggregates all').toBe(truth.all);
      // every grouping carries the scope
      for (const groupBy of ['customer', 'product', 'disposition']) {
        const res = await get(owner, q.replace('groupBy=day', 'groupBy=' + groupBy));
        expect(res.statusCode, groupBy + ' ' + res.body).toBe(200);
        expectNoLeak(res.body, [theirs.id, theirs.order.id], 'owner ' + groupBy + ' aggregate');
      }
    });
  });

  // ================================================================================================
  // approve / reject
  // ================================================================================================
  describe('approve / reject — approver capability, never seller scope or view_all', () => {
    it('ISO-APV-01 a seller cannot approve or reject — not even their own request (403), and nothing changes', async () => {
      const a = await approvalRequest(owner);
      const before = await approvalState(a);
      for (const path of ['approve', 'reject']) {
        expectDenied(await post(owner, `/api/v1/price-approvals/${a.id}/${path}`), [403], 'owner ' + path);
        expectDenied(await post(other, `/api/v1/price-approvals/${a.id}/${path}`), [403], 'other seller ' + path);
      }
      expectDenied(await post(owner, `/api/v1/price-approvals/${a.id}/approve`, { price: 100 }), [403], 'owner approving with a price edit');
      expect(await approvalState(a), 'refusals must change nothing: status, line price/total, payments, events, audit').toEqual(before);
    });

    it('ISO-APV-02 view_all grants no action: view_all-only and Vendedor + view_all are 403 on approve/reject, state unchanged', async () => {
      const a = await approvalRequest(owner);
      const before = await approvalState(a);
      for (const s of [viewAllOnly, viewAllFn, noPerm]) {
        for (const path of ['approve', 'reject']) expectDenied(await post(s, `/api/v1/price-approvals/${a.id}/${path}`), [403], 'view_all / no-permission ' + path);
      }
      expectDenied(await post(undefined, `/api/v1/price-approvals/${a.id}/approve`), [401], 'anonymous');
      expect(await approvalState(a)).toEqual(before);
    });

    it('ISO-APV-03 authorised approvers act across sellers: the Supervisor approves, the Administrador rejects, a seller who is also an approver approves — each writes exactly one event and one audit; the owner then confirms / is blocked', async () => {
      const a1 = await approvalRequest(owner);
      const b1 = await approvalState(a1);
      expect((await post(supervisor, `/api/v1/price-approvals/${a1.id}/approve`)).statusCode).toBe(200);
      const s1 = await approvalState(a1);
      expect(s1.row?.status).toBe('approved');
      expect(s1.row?.approvedBy).toBe(supervisor.user.id);
      expect(s1.approved).toBe(b1.approved + 1);
      expect(s1.auditApproved).toBe(b1.auditApproved + 1);
      expect((await post(owner, `/api/v1/orders/${a1.order.id}/confirm`, { payments: [{ paymentMethod: 'cash', amount: a1.order.total }] })).statusCode).toBe(200);

      const a2 = await approvalRequest(owner);
      const b2 = await approvalState(a2);
      expect((await post(admin, `/api/v1/price-approvals/${a2.id}/reject`)).statusCode).toBe(200);
      const s2 = await approvalState(a2);
      expect(s2.row?.status).toBe('rejected');
      expect(s2.rejected).toBe(b2.rejected + 1);
      expectDenied(await post(owner, `/api/v1/orders/${a2.order.id}/confirm`, { payments: [{ paymentMethod: 'cash', amount: a2.order.total }] }), [409], 'confirming after a rejection');

      const a3 = await approvalRequest(other);
      expect((await post(sellerApprover, `/api/v1/price-approvals/${a3.id}/approve`)).statusCode, 'the functional permission governs, not who placed the order').toBe(200);
    });

    it('ISO-APV-04 other tenant is 404 and malformed ids 400, with no change; ids of a request that is not theirs are unreachable', async () => {
      const a = await approvalRequest(owner);
      const before = await approvalState(a);
      for (const path of ['approve', 'reject']) {
        expectDenied(await post(foreignAdmin, `/api/v1/price-approvals/${a.id}/${path}`), [404], 'other tenant ' + path);
        expectDenied(await post(admin, `/api/v1/price-approvals/${NIL}/${path}`), [404], 'unknown id ' + path);
        expectDenied(await post(admin, `/api/v1/price-approvals/not-a-uuid/${path}`), [400], 'malformed id ' + path);
      }
      expect(await approvalState(a)).toEqual(before);
    });

    it('ISO-APV-05 states that do not admit a resolution: a resolved request cannot flip (409), repeating the same decision is idempotent (one event), a request of a cancelled order is 409', async () => {
      const a = await approvalRequest(owner);
      expect((await post(admin, `/api/v1/price-approvals/${a.id}/approve`)).statusCode).toBe(200);
      const afterFirst = await approvalState(a);
      expectDenied(await post(admin, `/api/v1/price-approvals/${a.id}/reject`), [409], 'reject after approve');
      const repeat = await post(supervisor, `/api/v1/price-approvals/${a.id}/approve`);
      expect([200, 409], repeat.body).toContain(repeat.statusCode);
      expect(await approvalState(a), 'a repeated or contradictory decision must not write another event/audit or change the row').toEqual(afterFirst);

      const c1 = await approvalRequest(owner);
      expect((await post(owner, `/api/v1/orders/${c1.order.id}/cancel`)).statusCode).toBe(200);
      const beforeCancelled = await approvalState(c1);
      expectDenied(await post(admin, `/api/v1/price-approvals/${c1.id}/approve`), [409], 'approve a cancelled request');
      expect(await approvalState(c1)).toEqual(beforeCancelled);
    });

    it('ISO-APV-06 approver price edit: only an approver can edit the price while approving (the line and totals change then, and only then); a seller attempting it changes nothing', async () => {
      const a = await approvalRequest(owner);
      const before = await approvalState(a);
      expectDenied(await post(owner, `/api/v1/price-approvals/${a.id}/approve`, { price: 100 }), [403], 'seller price edit');
      expect((await approvalState(a)).line).toEqual(before.line);
      const edited = await post(admin, `/api/v1/price-approvals/${a.id}/approve`, { price: 90 });
      expect(edited.statusCode, edited.body).toBe(200);
      const after = await approvalState(a);
      expect(Number(after.line?.unit)).toBe(90);
      expect(after.row?.status).toBe('approved');
    });

    it('ISO-APV-07 races: approve ‖ reject → exactly one wins (one event); approve ‖ approve → one event; approver ‖ seller → 200 + 403', async () => {
      const a = await approvalRequest(owner);
      const before = await approvalState(a);
      const [r1, r2] = await Promise.all([post(admin, `/api/v1/price-approvals/${a.id}/approve`), post(supervisor, `/api/v1/price-approvals/${a.id}/reject`)]);
      expect([r1.statusCode, r2.statusCode].sort(), r1.body + r2.body).toEqual([200, 409]);
      const mid = await approvalState(a);
      expect(mid.approved + mid.rejected, 'exactly one decision event').toBe(before.approved + before.rejected + 1);
      expect(mid.auditApproved + mid.auditRejected).toBe(before.auditApproved + before.auditRejected + 1);

      const b = await approvalRequest(owner);
      const bBefore = await approvalState(b);
      const [s1, s2] = await Promise.all([post(admin, `/api/v1/price-approvals/${b.id}/approve`), post(supervisor, `/api/v1/price-approvals/${b.id}/approve`)]);
      expect([s1.statusCode, s2.statusCode].every((s) => s === 200 || s === 409), s1.body + s2.body).toBe(true);
      expect((await approvalState(b)).approved).toBe(bBefore.approved + 1);

      const d = await approvalRequest(owner);
      const [ra, rs] = await Promise.all([post(admin, `/api/v1/price-approvals/${d.id}/approve`), post(owner, `/api/v1/price-approvals/${d.id}/approve`)]);
      expect([ra.statusCode, rs.statusCode]).toEqual([200, 403]);
    });
  });

  // ================================================================================================
  // inspect / resolve
  // ================================================================================================
  describe('inspect / resolve — warehouse capability, never seller scope or view_all', () => {
    it('ISO-RTW-01 sellers cannot inspect or resolve — not even their own return (403); nothing changes (status, dispositions, stock, movements, events, audit)', async () => {
      const r = await returnRequest(owner);
      const before = await returnState(r);
      for (const s of [owner, other]) {
        expectDenied(await inspect(s, r), [403], 'seller inspect');
        expectDenied(await resolve(s, r.id), [403], 'seller resolve');
      }
      expect(await returnState(r)).toEqual(before);
    });

    it('ISO-RTW-02 view_all grants no action: view_all-only, Vendedor + view_all, no-permission and anonymous are refused on inspect/resolve, state unchanged', async () => {
      const r = await returnRequest(owner);
      const before = await returnState(r);
      for (const s of [viewAllOnly, viewAllFn, noPerm]) {
        expectDenied(await inspect(s, r), [403], 'view_all / no-permission inspect');
        expectDenied(await resolve(s, r.id), [403], 'view_all / no-permission resolve');
      }
      expectDenied(await inspect(undefined, r), [401], 'anonymous inspect');
      expectDenied(await resolve(undefined, r.id), [401], 'anonymous resolve');
      expect(await returnState(r)).toEqual(before);
    });

    it('ISO-RTW-03 the warehouse acts across sellers: the Bodega (with its location) inspects and resolves another seller\'s return — one RETURN movement, stock restocked, one audit each', async () => {
      const r = await returnRequest(other, 2);
      const before = await returnState(r);
      expect((await inspect(bodega, r)).statusCode).toBe(200);
      const mid = await returnState(r);
      expect(mid.row?.status).toBe('inspecting');
      expect(mid.auditInspected).toBe(before.auditInspected + 1);
      expect(mid.movements, 'inspect moves no stock').toBe(before.movements);
      expect((await resolve(bodega, r.id)).statusCode).toBe(200);
      const after = await returnState(r);
      expect(after.row?.status).toBe('resolved');
      expect(after.movements).toBe(before.movements + 1);
      expect(after.stock).toBe(before.stock + r.quantity);
      expect(after.resolved).toBe(before.resolved + 1);
      expect(after.auditResolved).toBe(before.auditResolved + 1);
    });

    it('ISO-RTW-04 the Supervisor and the Administrador (both hold inventory.returns.manage) also process it; a Bodega WITHOUT a location assignment is refused and nothing changes', async () => {
      const r = await returnRequest(owner, 1);
      const before = await returnState(r);
      expectDenied(await inspect(bodegaNoLocation, r), [403, 404], 'Bodega with no location assignment');
      expect(await returnState(r), 'a location-denied inspect must change nothing').toEqual(before);
      expect((await inspect(supervisor, r)).statusCode).toBe(200);
      expect((await resolve(admin, r.id)).statusCode).toBe(200);
    });

    it('ISO-RTW-05 other tenant is 404 and malformed ids 400 on both routes, and a foreign disposition location is refused — no change', async () => {
      const r = await returnRequest(owner, 1);
      const before = await returnState(r);
      expectDenied(await inspect(foreignAdmin, r), [404], 'other tenant inspect');
      expectDenied(await resolve(foreignAdmin, r.id), [404], 'other tenant resolve');
      expectDenied(await post(bodega, `/api/v1/sales-returns/${NIL}/inspect`, inspectPayload(r)), [404], 'unknown id inspect');
      expectDenied(await resolve(bodega, NIL), [404], 'unknown id resolve');
      expectDenied(await post(bodega, '/api/v1/sales-returns/not-a-uuid/inspect', inspectPayload(r)), [400], 'malformed id inspect');
      expectDenied(await resolve(bodega, 'not-a-uuid'), [400], 'malformed id resolve');
      expectDenied(await inspect(bodega, r, { items: [{ returnItemId: r.itemId, disposition: 'restock', dispositionLocationId: foreignAdmin.user.tenantId }] }), [400, 404, 422], 'a tenant id used as a location');
      expectDenied(await inspect(bodega, r, { items: [{ returnItemId: NIL, disposition: 'restock', dispositionLocationId: locationId }] }), [400, 404, 409, 422], 'unknown return item');
      expectDenied(await inspect(bodega, r, { items: [{ returnItemId: r.itemId, disposition: 'sell-it-twice', dispositionLocationId: locationId }] }), [400], 'invalid disposition');
      expectDenied(await inspect(bodega, r, { items: [] }), [400], 'no items');
      expect(await returnState(r)).toEqual(before);
    });

    it('ISO-RTW-06 states that do not admit the action: resolve before inspect, inspect/resolve of a cancelled or resolved return — 409, no movement and no stock change', async () => {
      const fresh = await returnRequest(owner, 1);
      const b0 = await returnState(fresh);
      expectDenied(await resolve(bodega, fresh.id), [409, 422], 'resolve before inspect');
      expect(await returnState(fresh)).toEqual(b0);

      const cancelled = await returnRequest(owner, 1);
      expect((await post(owner, `/api/v1/sales-returns/${cancelled.id}/cancel`)).statusCode).toBe(200);
      const bc = await returnState(cancelled);
      expectDenied(await inspect(bodega, cancelled), [409], 'inspect a cancelled return');
      expectDenied(await resolve(bodega, cancelled.id), [409], 'resolve a cancelled return');
      expect(await returnState(cancelled)).toEqual(bc);

      const done = await returnRequest(owner, 1);
      expect((await inspect(bodega, done)).statusCode).toBe(200);
      expect((await resolve(bodega, done.id)).statusCode).toBe(200);
      const bd = await returnState(done);
      expectDenied(await inspect(bodega, done), [409], 'inspect a resolved return');
      expect(await returnState(done), 'a resolved return is immutable').toEqual(bd);
      expectDenied(await resolve(bodega, done.id, null), [400], 'resolve without an Idempotency-Key');
    });

    it('ISO-RTW-07 idempotency and races: the same key twice → one RETURN movement; two different keys at once → exactly one movement; resolve ‖ the owner\'s cancel → coherent', async () => {
      const a = await returnRequest(owner, 2);
      expect((await inspect(bodega, a)).statusCode).toBe(200);
      const aBefore = await returnState(a);
      const key = randomUUID();
      const [k1, k2] = await Promise.all([resolve(bodega, a.id, key), resolve(supervisor, a.id, key)]);
      expect([k1.statusCode, k2.statusCode].every((s) => s === 200 || s === 409), k1.body + k2.body).toBe(true);
      const aAfter = await returnState(a);
      expect(aAfter.movements).toBe(aBefore.movements + 1);
      expect(aAfter.stock).toBe(aBefore.stock + a.quantity);
      expect(aAfter.resolved).toBe(aBefore.resolved + 1);

      const b = await returnRequest(owner, 2);
      expect((await inspect(bodega, b)).statusCode).toBe(200);
      const bBefore = await returnState(b);
      const [r1, r2] = await Promise.all([resolve(bodega, b.id), resolve(admin, b.id)]);
      expect([r1.statusCode, r2.statusCode].every((s) => s === 200 || s === 409), r1.body + r2.body).toBe(true);
      expect((await returnState(b)).movements, 'two concurrent resolves must restock exactly once').toBe(bBefore.movements + 1);

      const d = await returnRequest(owner, 2);
      expect((await inspect(bodega, d)).statusCode).toBe(200);
      const dBefore = await returnState(d);
      const [res, can] = await Promise.all([resolve(bodega, d.id), post(owner, `/api/v1/sales-returns/${d.id}/cancel`)]);
      const dAfter = await returnState(d);
      expect([res.statusCode, can.statusCode].filter((s) => s === 200), res.body + can.body).toHaveLength(1);
      if (dAfter.row?.status === 'resolved') {
        expect(dAfter.movements).toBe(dBefore.movements + 1);
      } else {
        expect(dAfter.row?.status).toBe('cancelled');
        expect(dAfter.movements, 'a cancelled return must never restock').toBe(dBefore.movements);
        expect(dAfter.stock).toBe(dBefore.stock);
      }
    });
  });
});
