import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, inventoryBalances, inventoryMovements, salesReturnItems, salesReturns } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * PROMPT 013-A — real concurrency on the state transitions of ONE sales_return and ONE
 * price_approval. The serialization mechanism under test is `SELECT ... FOR UPDATE`:
 *
 *  - sales_returns: `SalesReturnsRepository.lockById` is the first DB op of `inspect`, `resolve`
 *    and `cancel` (for `resolve`, after the per-key advisory lock + idempotency-table check). The
 *    loser blocks there, re-reads the now-terminal status, and fails (409) or no-ops idempotently.
 *  - price_approvals: `PriceApprovalsRepository.lockById` (FOR UPDATE) + a
 *    `UPDATE ... WHERE status = 'pending' RETURNING` CAS in `resolveIfPending`; audit is written
 *    only when the CAS returns a row. `OrdersService.confirm` locks the approvals via
 *    `lockByOrder` (FOR UPDATE) inside the txn that already holds the `orders` row lock.
 *
 * No mocks — PostgreSQL manages the locks; movement / audit / balance rows are read straight from
 * the database, never inferred from the HTTP response. Races whose winner is non-deterministic are
 * run several times; the winner may vary, the invariants may not.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: state-transition concurrency (integration, PROMPT 013-A)', () => {
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

  // ----------------------------------------------------------------------------
  //  DB probes (as the migrator role — bypasses RLS, reads the raw truth)
  // ----------------------------------------------------------------------------
  async function returnStatus(id: string): Promise<string | undefined> {
    const { client, db } = getMigratorDb();
    try {
      const [row] = await db.select({ status: salesReturns.status }).from(salesReturns).where(eq(salesReturns.id, id));
      return row?.status;
    } finally {
      await client.end();
    }
  }

  async function returnItemRows(tenantId: string, returnId: string) {
    const { client, db } = getMigratorDb();
    try {
      return await db
        .select()
        .from(salesReturnItems)
        .where(and(eq(salesReturnItems.tenantId, tenantId), eq(salesReturnItems.returnId, returnId)));
    } finally {
      await client.end();
    }
  }

  async function returnMovementCount(tenantId: string, returnItemIds: string[]): Promise<number> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ referenceId: inventoryMovements.referenceId })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.movementType, 'RETURN'),
            eq(inventoryMovements.referenceType, 'sales_return_item'),
          ),
        );
      return rows.filter((r) => r.referenceId !== null && returnItemIds.includes(r.referenceId)).length;
    } finally {
      await client.end();
    }
  }

  async function auditCount(tenantId: string, entityType: string, entityId: string, actionCode: string): Promise<number> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ actionCode: auditLog.actionCode })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)));
      return rows.filter((r) => r.actionCode === actionCode).length;
    } finally {
      await client.end();
    }
  }

  async function physicalAt(tenantId: string, variantId: string, locationId: string): Promise<number> {
    const { client, db } = getMigratorDb();
    try {
      const [row] = await db
        .select({ q: inventoryBalances.quantityPhysical })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.productVariantId, variantId),
            eq(inventoryBalances.locationId, locationId),
          ),
        );
      return row ? Number(row.q) : 0;
    } finally {
      await client.end();
    }
  }

  async function saleMovementCount(tenantId: string, orderId: string): Promise<number> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ movementType: inventoryMovements.movementType })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.referenceType, 'order'),
            eq(inventoryMovements.referenceId, orderId),
          ),
        );
      return rows.filter((r) => r.movementType === 'SALE').length;
    } finally {
      await client.end();
    }
  }

  // ==========================================================================
  //  PART A — SALES RETURN transitions
  // ==========================================================================
  describe('sales_returns — inspect / resolve / cancel', () => {
    interface Fixture {
      admin: Session;
      tenantId: string;
      sellLocationId: string;
      quarantineLocationId: string;
      variantId: string;
      customerId: string;
    }

    async function seed(): Promise<Fixture> {
      const admin = await c.registerTenant(`RT ${uniq()}`, `rt-${uniq()}@ex.com`);
      const tenantId = admin.user.tenantId;
      const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
      const sellLocationId = await c.createLocation(admin, warehouseId, `SELL-${uniq()}`, { isSellable: true });
      const quarantineLocationId = await c.createLocation(admin, warehouseId, `QUAR-${uniq()}`, { isSellable: false });
      const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
      await c.receiveStock(admin, variantId, sellLocationId, 500);
      const customerId = await c.createCustomer(admin, c.fullCustomer(`rt-${uniq()}`));
      return { admin, tenantId, sellLocationId, quarantineLocationId, variantId, customerId };
    }

    /** A confirmed order for `lines.length` lines of the fixture variant, then a `requested` return
     * for `qty` units of each line. Returns the return id + its item ids. */
    async function requestedReturn(f: Fixture, lines: number, qty: number): Promise<{ returnId: string; itemIds: string[] }> {
      const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.sellLocationId, customerId: f.customerId } });
      const cartId = (JSON.parse(created.body) as { id: string }).id;
      const orderItemIds: string[] = [];
      // One variant per line — add distinct variants so the order has N lines.
      const variantIds: string[] = [f.variantId];
      for (let i = 1; i < lines; i += 1) {
        const { variantId } = await c.createProductVariant(f.admin, { sku: `SKU-${uniq()}-${i}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
        await c.receiveStock(f.admin, variantId, f.sellLocationId, 500);
        variantIds.push(variantId);
      }
      for (const v of variantIds) {
        const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: v, quantity: qty + 5 } });
        expect(added.statusCode, added.body).toBe(200);
      }
      const total = variantIds.length * (qty + 5) * 100;
      const order = await c.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
        payload: { cartId, documentType: 'sales_note' },
      });
      const body = JSON.parse(order.body) as { id: string; items: { id: string }[] };
      for (const it of body.items) orderItemIds.push(it.id);
      const confirmed = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${body.id}/confirm`,
        headers: c.writeHeaders(f.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: total }] },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);

      const ret = await c.inject({
        method: 'POST',
        url: '/api/v1/sales-returns',
        headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
        payload: { orderId: body.id, locationId: f.sellLocationId, reason: 'concurrency test', items: orderItemIds.map((id) => ({ orderItemId: id, quantity: qty })) },
      });
      expect(ret.statusCode, ret.body).toBe(201);
      const retBody = JSON.parse(ret.body) as { id: string; items: { id: string }[] };
      return { returnId: retBody.id, itemIds: retBody.items.map((i) => i.id) };
    }

    const inspect = (session: Session, id: string, payload: Record<string, unknown>) =>
      c.inject({ method: 'POST', url: `/api/v1/sales-returns/${id}/inspect`, headers: c.writeHeaders(session), payload });
    const resolve = (session: Session, id: string, key = randomUUID()) =>
      c.inject({ method: 'POST', url: `/api/v1/sales-returns/${id}/resolve`, headers: c.writeHeaders(session, { 'idempotency-key': key }) });
    const cancel = (session: Session, id: string) =>
      c.inject({ method: 'POST', url: `/api/v1/sales-returns/${id}/cancel`, headers: c.writeHeaders(session) });

    async function inspectAll(session: Session, returnId: string, itemIds: string[], disposition: 'restock' | 'quarantine', locationId: string) {
      const r = await inspect(session, returnId, { items: itemIds.map((returnItemId) => ({ returnItemId, disposition, dispositionLocationId: locationId })) });
      expect(r.statusCode, r.body).toBe(200);
    }

    // ---- R13 — inspect vs inspect ------------------------------------------
    it('R13: inspect || inspect on a requested return — every item ends coherent, never field-mixed', async () => {
      const f = await seed();
      const a = await c.createAndLoginAs(f.admin, `insA-${uniq()}@ex.com`, 'Supervisor');
      const b = await c.createAndLoginAs(f.admin, `insB-${uniq()}@ex.com`, 'Supervisor');
      // ADR-0035: Supervisor is not the founding Administrador, so inspecting a return's
      // disposition locations now needs an explicit assignment.
      await c.setUserLocations(f.admin, a.user.id, [f.sellLocationId, f.quarantineLocationId]);
      await c.setUserLocations(f.admin, b.user.id, [f.sellLocationId, f.quarantineLocationId]);
      for (let run = 0; run < 6; run += 1) {
        const { returnId, itemIds } = await requestedReturn(f, 1, 2);
        const [ra, rb] = await Promise.all([
          inspect(a, returnId, { items: itemIds.map((returnItemId) => ({ returnItemId, disposition: 'restock', dispositionLocationId: f.sellLocationId })) }),
          inspect(b, returnId, { items: itemIds.map((returnItemId) => ({ returnItemId, disposition: 'quarantine', dispositionLocationId: f.quarantineLocationId })) }),
        ]);
        expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]); // second re-inspects (allowed from `inspecting`)
        expect(await returnStatus(returnId)).toBe('inspecting');
        const items = await returnItemRows(f.tenantId, returnId);
        for (const item of items) {
          const fromA = item.disposition === 'restock' && item.dispositionLocationId === f.sellLocationId && item.inspectedBy === a.user.id;
          const fromB = item.disposition === 'quarantine' && item.dispositionLocationId === f.quarantineLocationId && item.inspectedBy === b.user.id;
          expect(fromA || fromB, `item ${item.id}: {${item.disposition}, ${item.dispositionLocationId}, by ${item.inspectedBy}} is a mix`).toBe(true);
          expect(item.inspectedAt).not.toBeNull();
        }
        expect(await returnMovementCount(f.tenantId, itemIds)).toBe(0); // inspection never touches inventory
      }
    });

    // ---- R14 — inspect vs cancel -----------------------------------------
    it('R14: inspect || cancel on a requested return — exactly one transition leaves `requested`; never partial inspection; no inventory', async () => {
      const f = await seed();
      const inspector = await c.createAndLoginAs(f.admin, `r14i-${uniq()}@ex.com`, 'Supervisor');
      // ADR-0035: needs an explicit assignment now (see R13 above).
      await c.setUserLocations(f.admin, inspector.user.id, [f.sellLocationId, f.quarantineLocationId]);
      for (let run = 0; run < 6; run += 1) {
        const { returnId, itemIds } = await requestedReturn(f, 1, 2);
        const [ins, can] = await Promise.all([
          inspect(inspector, returnId, { items: itemIds.map((returnItemId) => ({ returnItemId, disposition: 'restock', dispositionLocationId: f.sellLocationId })) }),
          cancel(f.admin, returnId),
        ]);
        // cancel wins the race → inspect sees `cancelled` → 409; inspect wins the race → cancel then
        // runs from `inspecting` → 200. Either way cancel ultimately applies.
        expect(can.statusCode).toBe(200);
        expect([200, 409]).toContain(ins.statusCode);
        expect(await returnStatus(returnId)).toBe('cancelled');
        expect(await returnMovementCount(f.tenantId, itemIds)).toBe(0);
        expect(await auditCount(f.tenantId, 'sales_return', returnId, 'sales_return.resolved')).toBe(0);
        expect(await auditCount(f.tenantId, 'sales_return', returnId, 'sales_return.cancelled')).toBe(1);
        // Inspection, if it committed at all, is atomic — every item inspected or none.
        const items = await returnItemRows(f.tenantId, returnId);
        const inspected = items.filter((i) => i.disposition !== null);
        expect(inspected.length === 0 || inspected.length === items.length).toBe(true);
      }
    });

    // ---- R15 — resolve vs cancel (the critical case) ---------------------
    it('R15: resolve || cancel on an inspecting return — exactly one wins; status ⟺ inventory ⟺ audit', async () => {
      const f = await seed();
      let resolvedWins = 0;
      let cancelledWins = 0;
      for (let run = 0; run < 8; run += 1) {
        const { returnId, itemIds } = await requestedReturn(f, 1, 3);
        await inspectAll(f.admin, returnId, itemIds, 'restock', f.sellLocationId);
        const before = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);

        const [res, can] = await Promise.all([resolve(f.admin, returnId), cancel(f.admin, returnId)]);
        const status = await returnStatus(returnId);
        const movements = await returnMovementCount(f.tenantId, itemIds);
        const resolvedAudit = await auditCount(f.tenantId, 'sales_return', returnId, 'sales_return.resolved');
        const cancelledAudit = await auditCount(f.tenantId, 'sales_return', returnId, 'sales_return.cancelled');
        const after = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);

        expect([res.statusCode, can.statusCode].filter((s) => s === 200)).toHaveLength(1);
        expect([res.statusCode, can.statusCode].filter((s) => s === 409)).toHaveLength(1);

        if (status === 'resolved') {
          resolvedWins += 1;
          expect(movements).toBe(1);
          expect(resolvedAudit).toBe(1);
          expect(cancelledAudit).toBe(0);
          expect(after).toBe(before + 3);
        } else {
          cancelledWins += 1;
          expect(status).toBe('cancelled');
          expect(movements).toBe(0);
          expect(resolvedAudit).toBe(0);
          expect(cancelledAudit).toBe(1);
          expect(after).toBe(before);
        }
      }
      // Both outcomes are legal; log the split for the report.
      expect(resolvedWins + cancelledWins).toBe(8);
    });

    // ---- R16 — cancel vs cancel -----------------------------------------
    it('R16: cancel || cancel — one logical cancel, one audit, no inventory', async () => {
      const f = await seed();
      for (let run = 0; run < 4; run += 1) {
        const { returnId, itemIds } = await requestedReturn(f, 1, 2);
        const [a, b] = await Promise.all([cancel(f.admin, returnId), cancel(f.admin, returnId)]);
        expect([a.statusCode, b.statusCode]).toEqual([200, 200]); // cancel is idempotent
        expect(await returnStatus(returnId)).toBe('cancelled');
        expect(await auditCount(f.tenantId, 'sales_return', returnId, 'sales_return.cancelled')).toBe(1);
        expect(await returnMovementCount(f.tenantId, itemIds)).toBe(0);
      }
    });

    // ---- R16b — resolve vs resolve (regression, must stay exactly-once) ---
    it('R16b: resolve || resolve — one inventory effect, final resolved, second idempotent', async () => {
      const f = await seed();
      const { returnId, itemIds } = await requestedReturn(f, 1, 4);
      await inspectAll(f.admin, returnId, itemIds, 'restock', f.sellLocationId);
      const before = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);
      const [a, b] = await Promise.all([resolve(f.admin, returnId), resolve(f.admin, returnId)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect(await returnStatus(returnId)).toBe('resolved');
      expect(await returnMovementCount(f.tenantId, itemIds)).toBe(1);
      expect(await auditCount(f.tenantId, 'sales_return', returnId, 'sales_return.resolved')).toBe(1);
      expect(await physicalAt(f.tenantId, f.variantId, f.sellLocationId)).toBe(before + 4);
    });

    // ---- R17 — terminal-state regression -------------------------------
    it('R17: cancelled → inspect/resolve forbidden; resolved → cancel forbidden', async () => {
      const f = await seed();
      // cancelled
      const cancelled = await requestedReturn(f, 1, 2);
      expect((await cancel(f.admin, cancelled.returnId)).statusCode).toBe(200);
      expect((await inspect(f.admin, cancelled.returnId, { items: [{ returnItemId: cancelled.itemIds[0], disposition: 'restock', dispositionLocationId: f.sellLocationId }] })).statusCode).toBe(409);
      expect((await resolve(f.admin, cancelled.returnId)).statusCode).toBe(409);
      expect(await returnMovementCount(f.tenantId, cancelled.itemIds)).toBe(0);
      // resolved
      const resolved = await requestedReturn(f, 1, 2);
      await inspectAll(f.admin, resolved.returnId, resolved.itemIds, 'restock', f.sellLocationId);
      expect((await resolve(f.admin, resolved.returnId)).statusCode).toBe(200);
      expect((await cancel(f.admin, resolved.returnId)).statusCode).toBe(409);
      expect(await returnStatus(resolved.returnId)).toBe('resolved');
      expect(await returnMovementCount(f.tenantId, resolved.itemIds)).toBe(1);
    });

    // ---- R18 — multi-line resolve vs cancel ----------------------------
    it('R18: multi-line resolve || cancel — RETURN is 1-per-line or 0, never partial', async () => {
      const f = await seed();
      for (let run = 0; run < 6; run += 1) {
        const { returnId, itemIds } = await requestedReturn(f, 3, 2);
        await inspectAll(f.admin, returnId, itemIds, 'restock', f.sellLocationId);
        const [res, can] = await Promise.all([resolve(f.admin, returnId), cancel(f.admin, returnId)]);
        expect([res.statusCode, can.statusCode].filter((s) => s === 200)).toHaveLength(1);
        const status = await returnStatus(returnId);
        const movements = await returnMovementCount(f.tenantId, itemIds);
        if (status === 'resolved') {
          expect(movements).toBe(itemIds.length); // one RETURN per line, all-or-nothing
        } else {
          expect(status).toBe('cancelled');
          expect(movements).toBe(0);
        }
      }
    });

    // ---- R19 — resolve failure atomicity ------------------------------
    it('R19: a mid-loop failure during resolve rolls back every RETURN — status stays inspecting', async () => {
      const f = await seed();
      const otherWarehouse = await c.createWarehouse(f.admin, `WH2-${uniq()}`);
      const locA = await c.createLocation(f.admin, otherWarehouse, `A-${uniq()}`, { isSellable: true });
      const locB = await c.createLocation(f.admin, otherWarehouse, `B-${uniq()}`, { isSellable: true });

      const { returnId, itemIds } = await requestedReturn(f, 2, 2);
      // Admin (unrestricted) routes line 1 -> locA, line 2 -> locB.
      const insA = await inspect(f.admin, returnId, {
        items: [
          { returnItemId: itemIds[0], disposition: 'restock', dispositionLocationId: locA },
          { returnItemId: itemIds[1], disposition: 'restock', dispositionLocationId: locB },
        ],
      });
      expect(insA.statusCode, insA.body).toBe(200);

      // A resolver authorized ONLY at locA — line 2's location-auth check fails mid-loop.
      const resolver = await c.createAndLoginAs(f.admin, `r19-${uniq()}@ex.com`, 'Supervisor');
      await c.setUserLocations(f.admin, resolver.user.id, [locA]);
      const res = await resolve(resolver, returnId);
      expect(res.statusCode).toBe(403);

      expect(await returnStatus(returnId)).toBe('inspecting'); // not resolved, not failed
      expect(await returnMovementCount(f.tenantId, itemIds)).toBe(0); // line 1's RETURN rolled back too
      expect(await auditCount(f.tenantId, 'sales_return', returnId, 'sales_return.resolved')).toBe(0);

      // An authorized resolver then completes it cleanly — exactly-once still holds.
      expect((await resolve(f.admin, returnId)).statusCode).toBe(200);
      expect(await returnMovementCount(f.tenantId, itemIds)).toBe(2);
    });
  });

  // ==========================================================================
  //  PART B — PRICE APPROVAL transitions
  // ==========================================================================
  describe('price_approvals — approve / reject / confirm', () => {
    interface Fixture {
      admin: Session;
      tenantId: string;
      locationId: string;
      variantId: string;
      customerId: string;
      seller: Session;
      approverA: Session;
      approverB: Session;
    }

    async function seed(): Promise<Fixture> {
      const admin = await c.registerTenant(`PA ${uniq()}`, `pa-${uniq()}@ex.com`);
      const tenantId = admin.user.tenantId;
      const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
      const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
      const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
      await c.receiveStock(admin, variantId, locationId, 500);
      const customerId = await c.createCustomer(admin, c.fullCustomer(`pa-${uniq()}`));
      const seller = await c.createAndLoginAs(admin, `sell-${uniq()}@ex.com`, 'Vendedor');
      // ADR-0035: seller checks out and confirms (both location-scoped) and is not the founding
      // Administrador, so it needs an explicit assignment. approverA/approverB never touch
      // LocationAuthorizationService (PriceApprovalsService is location-agnostic), so they don't.
      await c.setUserLocations(admin, seller.user.id, [locationId]);
      const approverA = await c.createAndLoginAs(admin, `apA-${uniq()}@ex.com`, 'Supervisor');
      const approverB = await c.createAndLoginAs(admin, `apB-${uniq()}@ex.com`, 'Supervisor');
      return { admin, tenantId, locationId, variantId, customerId, seller, approverA, approverB };
    }

    /** A `pending` order with one below-min exceptional line, plus a `pending` price_approvals row
     * filed by the seller. */
    async function pendingApproval(f: Fixture): Promise<{ orderId: string; approvalId: string }> {
      const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.seller), payload: { locationId: f.locationId, customerId: f.customerId } });
      const cartId = (JSON.parse(created.body) as { id: string }).id;
      await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.seller), payload: { productVariantId: f.variantId, quantity: 1, negotiatedUnitPrice: 70 } });
      const order = await c.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: c.writeHeaders(f.seller, { 'idempotency-key': randomUUID() }),
        payload: { cartId, documentType: 'sales_note' },
      });
      const body = JSON.parse(order.body) as { id: string; items: { id: string; isExceptionalDiscount: boolean }[] };
      expect(body.items[0]!.isExceptionalDiscount).toBe(true);
      const req = await c.inject({ method: 'POST', url: '/api/v1/price-approvals', headers: c.writeHeaders(f.seller), payload: { orderItemId: body.items[0]!.id, reason: 'concurrency test' } });
      expect(req.statusCode, req.body).toBe(201);
      return { orderId: body.id, approvalId: (JSON.parse(req.body) as { id: string }).id };
    }

    const approve = (session: Session, id: string) =>
      c.inject({ method: 'POST', url: `/api/v1/price-approvals/${id}/approve`, headers: c.writeHeaders(session) });
    const reject = (session: Session, id: string) =>
      c.inject({ method: 'POST', url: `/api/v1/price-approvals/${id}/reject`, headers: c.writeHeaders(session) });
    // Owner redesign: the payment method is now picked at confirm — `pendingApproval()`'s fixture
    // line is always 1 unit @ negotiatedUnitPrice 70, so the total is always 70.
    const confirm = (session: Session, orderId: string) =>
      c.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/confirm`,
        headers: c.writeHeaders(session),
        payload: { payments: [{ paymentMethod: 'cash', amount: 70 }] },
      });

    async function approvalStatus(f: Fixture, id: string): Promise<string> {
      const r = await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${id}`, headers: c.readHeaders(f.admin) });
      return (JSON.parse(r.body) as { status: string }).status;
    }
    async function orderStatus(f: Fixture, id: string): Promise<string> {
      const r = await c.inject({ method: 'GET', url: `/api/v1/orders/${id}`, headers: c.readHeaders(f.admin) });
      return (JSON.parse(r.body) as { status: string }).status;
    }

    // ---- P19 — approve vs reject --------------------------------------
    it('P19: approve || reject — exactly one final status, exactly one resolution audit', async () => {
      const f = await seed();
      let approvedWins = 0;
      let rejectedWins = 0;
      for (let run = 0; run < 8; run += 1) {
        const { approvalId } = await pendingApproval(f);
        const [ap, rj] = await Promise.all([approve(f.approverA, approvalId), reject(f.approverB, approvalId)]);
        expect([ap.statusCode, rj.statusCode].filter((s) => s === 200)).toHaveLength(1);
        expect([ap.statusCode, rj.statusCode].filter((s) => s === 409)).toHaveLength(1);
        const status = await approvalStatus(f, approvalId);
        const approvedAudit = await auditCount(f.tenantId, 'price_approval', approvalId, 'price_approval.approved');
        const rejectedAudit = await auditCount(f.tenantId, 'price_approval', approvalId, 'price_approval.rejected');
        expect(approvedAudit + rejectedAudit).toBe(1);
        if (status === 'approved') {
          approvedWins += 1;
          expect(approvedAudit).toBe(1);
        } else {
          expect(status).toBe('rejected');
          rejectedWins += 1;
          expect(rejectedAudit).toBe(1);
        }
      }
      expect(approvedWins + rejectedWins).toBe(8);
    });

    // ---- P20 — approve vs approve ------------------------------------
    it('P20: approve || approve — one logical approval, one audit', async () => {
      const f = await seed();
      for (let run = 0; run < 4; run += 1) {
        const { approvalId } = await pendingApproval(f);
        const [a, b] = await Promise.all([approve(f.approverA, approvalId), approve(f.approverB, approvalId)]);
        expect([a.statusCode, b.statusCode]).toEqual([200, 200]); // second is idempotent
        expect(await approvalStatus(f, approvalId)).toBe('approved');
        expect(await auditCount(f.tenantId, 'price_approval', approvalId, 'price_approval.approved')).toBe(1);
      }
    });

    // ---- P21 — reject vs reject ------------------------------------
    it('P21: reject || reject — one logical rejection, one audit', async () => {
      const f = await seed();
      for (let run = 0; run < 4; run += 1) {
        const { approvalId } = await pendingApproval(f);
        const [a, b] = await Promise.all([reject(f.approverA, approvalId), reject(f.approverB, approvalId)]);
        expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
        expect(await approvalStatus(f, approvalId)).toBe('rejected');
        expect(await auditCount(f.tenantId, 'price_approval', approvalId, 'price_approval.rejected')).toBe(1);
      }
    });

    // ---- P22 — terminal approval regression ----------------------
    it('P22: rejected → approve forbidden; approved → reject forbidden', async () => {
      const f = await seed();
      const r1 = await pendingApproval(f);
      expect((await reject(f.approverA, r1.approvalId)).statusCode).toBe(200);
      expect((await approve(f.approverA, r1.approvalId)).statusCode).toBe(409);
      expect(await approvalStatus(f, r1.approvalId)).toBe('rejected');

      const r2 = await pendingApproval(f);
      expect((await approve(f.approverA, r2.approvalId)).statusCode).toBe(200);
      expect((await reject(f.approverA, r2.approvalId)).statusCode).toBe(409);
      expect(await approvalStatus(f, r2.approvalId)).toBe('approved');
    });

    // ---- P23 — approve vs confirm ------------------------------
    it('P23: approve || confirm — confirm only ever proceeds with an approved approval', async () => {
      const f = await seed();
      for (let run = 0; run < 6; run += 1) {
        const { orderId, approvalId } = await pendingApproval(f);
        const [ap, cf] = await Promise.all([approve(f.approverA, approvalId), confirm(f.seller, orderId)]);
        expect(ap.statusCode).toBe(200);
        if (cf.statusCode === 200) {
          // confirm observed `approved` → SALE committed
          expect(await orderStatus(f, orderId)).toBe('confirmed');
          expect(await approvalStatus(f, approvalId)).toBe('approved');
          expect(await saleMovementCount(f.tenantId, orderId)).toBe(1);
        } else {
          // confirm observed `pending` → 409, no SALE; a retry now succeeds
          expect(cf.statusCode).toBe(409);
          expect(await orderStatus(f, orderId)).toBe('pending');
          expect(await saleMovementCount(f.tenantId, orderId)).toBe(0);
          expect(await approvalStatus(f, approvalId)).toBe('approved');
          expect((await confirm(f.seller, orderId)).statusCode).toBe(200);
          expect(await saleMovementCount(f.tenantId, orderId)).toBe(1);
        }
      }
    });

    // ---- P24 — reject vs confirm -----------------------------
    it('P24: reject || confirm — a SALE never commits against a rejected approval', async () => {
      const f = await seed();
      for (let run = 0; run < 6; run += 1) {
        const { orderId, approvalId } = await pendingApproval(f);
        const [rj, cf] = await Promise.all([reject(f.approverA, approvalId), confirm(f.seller, orderId)]);
        expect(rj.statusCode).toBe(200);
        expect(cf.statusCode).toBe(409); // pending OR rejected at gate time — either way, blocked
        expect(await orderStatus(f, orderId)).toBe('pending');
        expect(await approvalStatus(f, approvalId)).toBe('rejected');
        expect(await saleMovementCount(f.tenantId, orderId)).toBe(0);
        // And it stays blocked — the rejected approval can never authorize this line.
        expect((await confirm(f.seller, orderId)).statusCode).toBe(409);
      }
    });

    // ---- P25 — self-approval allowed (ADR-0022 amendment, 2026-10-26); the CAS still resolves once ----
    it('P25: a holder of pricing.discount.approve can approve their own request; the CAS still resolves it once', async () => {
      const f = await seed();
      // Give the seller pricing.discount.approve too by using an Admin who is also the requester.
      const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
      const cartId = (JSON.parse(created.body) as { id: string }).id;
      await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity: 1, negotiatedUnitPrice: 70 } });
      const order = await c.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
        payload: { cartId, documentType: 'sales_note' },
      });
      const body = JSON.parse(order.body) as { items: { id: string }[] };
      const req = await c.inject({ method: 'POST', url: '/api/v1/price-approvals', headers: c.writeHeaders(f.admin), payload: { orderItemId: body.items[0]!.id, reason: 'self' } });
      const approvalId = (JSON.parse(req.body) as { id: string }).id;
      expect((await approve(f.admin, approvalId)).statusCode).toBe(200);
      expect((await reject(f.admin, approvalId)).statusCode).toBe(409);
      expect(await approvalStatus(f, approvalId)).toBe('approved');
    });
  });
});
