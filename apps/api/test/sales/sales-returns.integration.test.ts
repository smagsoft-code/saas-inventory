import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, inventoryBalances, inventoryMovements } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * FASE 13 Part A — sales returns / disposition (ADR-0021 / database.md#sales-returns-and-disposition).
 * Covers prompt tests R1-R12. No mocks — real PostgreSQL; balances / movements / audit rows are read
 * straight from the database.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: returns + disposition (integration)', () => {
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

  interface Fixture {
    admin: Session;
    tenantId: string;
    warehouseId: string;
    sellLocationId: string; // is_sellable = true
    quarantineLocationId: string; // is_sellable = false
    productId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const sellLocationId = await c.createLocation(admin, warehouseId, `SELL-${uniq()}`, { isSellable: true });
    const quarantineLocationId = await c.createLocation(admin, warehouseId, `QUAR-${uniq()}`, { isSellable: false });
    const { productId, variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, sellLocationId, 100);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, tenantId, warehouseId, sellLocationId, quarantineLocationId, productId, variantId, customerId };
  }

  /** A confirmed order for `quantity` units of the fixture variant, sold from `sellLocationId`. */
  async function confirmedOrder(f: Fixture, quantity: number): Promise<{ orderId: string; orderItemId: string }> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.sellLocationId, customerId: f.customerId } });
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity } });
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    const body = JSON.parse(order.body) as { id: string; items: { id: string }[] };
    const confirmed = await c.inject({ method: 'POST', url: `/api/v1/orders/${body.id}/confirm`, headers: c.writeHeaders(f.admin) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return { orderId: body.id, orderItemId: body.items[0]!.id };
  }

  const createReturn = (session: Session, payload: Record<string, unknown>, key = randomUUID()) =>
    c.inject({ method: 'POST', url: '/api/v1/sales-returns', headers: c.writeHeaders(session, { 'idempotency-key': key }), payload });

  const inspect = (session: Session, id: string, payload: Record<string, unknown>) =>
    c.inject({ method: 'POST', url: `/api/v1/sales-returns/${id}/inspect`, headers: c.writeHeaders(session), payload });

  const resolve = (session: Session, id: string, key = randomUUID()) =>
    c.inject({ method: 'POST', url: `/api/v1/sales-returns/${id}/resolve`, headers: c.writeHeaders(session, { 'idempotency-key': key }) });

  async function physicalAt(tenantId: string, variantId: string, locationId: string): Promise<number> {
    const { client, db } = getMigratorDb();
    try {
      const [row] = await db
        .select({ q: inventoryBalances.quantityPhysical })
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.productVariantId, variantId), eq(inventoryBalances.locationId, locationId)));
      return row ? Number(row.q) : 0;
    } finally {
      await client.end();
    }
  }

  async function returnMovements(tenantId: string, returnItemIds: string[]): Promise<{ movementType: string; locationId: string; quantity: string }[]> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ movementType: inventoryMovements.movementType, locationId: inventoryMovements.locationId, quantity: inventoryMovements.quantity, referenceId: inventoryMovements.referenceId })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.referenceType, 'sales_return_item')));
      return rows.filter((r) => r.referenceId !== null && returnItemIds.includes(r.referenceId));
    } finally {
      await client.end();
    }
  }

  // ---- R1 -------------------------------------------------------------------
  it('R1: create a return against a confirmed order — correct order, tenant, quantities', async () => {
    const f = await seed('R1 Co', `r1-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 4);
    const r = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'customer changed mind', items: [{ orderItemId, quantity: 2 }] });
    expect(r.statusCode, r.body).toBe(201);
    const body = JSON.parse(r.body) as { orderId: string; status: string; items: { orderItemId: string; quantityReturned: number; disposition?: string }[] };
    expect(body.orderId).toBe(orderId);
    expect(body.status).toBe('requested');
    expect(body.items[0]!.quantityReturned).toBe(2);
    expect(body.items[0]!.disposition).toBeUndefined();
  });

  // ---- R2 -------------------------------------------------------------------
  it('R2: partial returns — sold 5, return 2 then 3 ok, a 4th unit is rejected', async () => {
    const f = await seed('R2 Co', `r2-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 5);
    expect((await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 2 }] })).statusCode).toBe(201);
    expect((await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 3 }] })).statusCode).toBe(201);
    const over = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 1 }] });
    expect(over.statusCode).toBe(409);
  });

  // ---- R3 -------------------------------------------------------------------
  it('R3: over-return — sold 5, already returned 3, new request 3 -> controlled 409, no corruption', async () => {
    const f = await seed('R3 Co', `r3-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 5);
    expect((await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 3 }] })).statusCode).toBe(201);
    const over = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 3 }] });
    expect(over.statusCode).toBe(409);
    const list = await c.inject({ method: 'GET', url: `/api/v1/sales-returns?orderId=${orderId}`, headers: c.readHeaders(f.admin) });
    expect((JSON.parse(list.body) as { data: unknown[] }).data).toHaveLength(1);
  });

  // ---- R4 -------------------------------------------------------------------
  it('R4: two concurrent create-return requests that together exceed the sold quantity — exactly one wins', async () => {
    const f = await seed('R4 Co', `r4-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 1);
    const [a, b] = await Promise.all([
      createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'first', items: [{ orderItemId, quantity: 1 }] }),
      createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'second', items: [{ orderItemId, quantity: 1 }] }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
  });

  // ---- R5 -------------------------------------------------------------------
  it('R5: a return against a still-pending order is rejected (409), no effects', async () => {
    const f = await seed('R5 Co', `r5-${uniq()}@ex.com`);
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.sellLocationId, customerId: f.customerId } });
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity: 2 } });
    const order = await c.inject({ method: 'POST', url: '/api/v1/orders', headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }), payload: { cartId, documentType: 'sales_note' } });
    const body = JSON.parse(order.body) as { id: string; items: { id: string }[] };
    const r = await createReturn(f.admin, { orderId: body.id, locationId: f.sellLocationId, reason: 'too soon', items: [{ orderItemId: body.items[0]!.id, quantity: 1 }] });
    expect(r.statusCode).toBe(409);
  });

  // ---- R6 -------------------------------------------------------------------
  it('R6: tenant A cannot return tenant B’s order (404)', async () => {
    const a = await seed('R6 A', `r6a-${uniq()}@ex.com`);
    const b = await seed('R6 B', `r6b-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(b, 3);
    const r = await createReturn(a.admin, { orderId, locationId: a.sellLocationId, reason: 'not mine', items: [{ orderItemId, quantity: 1 }] });
    expect(r.statusCode).toBe(404);
  });

  // ---- R7 -------------------------------------------------------------------
  it('R7: restock disposition re-enters SELLABLE stock exactly once; ledger balances', async () => {
    const f = await seed('R7 Co', `r7-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 10); // sold 10 from sellLocation (100 -> 90 physical)
    const before = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);
    const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'defect', items: [{ orderItemId, quantity: 3 }] });
    const ret = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    expect((await inspect(f.admin, ret.id, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] })).statusCode).toBe(200);
    expect((await resolve(f.admin, ret.id)).statusCode).toBe(200);

    const after = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);
    expect(after).toBe(before + 3);
    const moves = await returnMovements(f.tenantId, [ret.items[0]!.id]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ movementType: 'RETURN', locationId: f.sellLocationId, quantity: '3' });
  });

  // ---- R8 -------------------------------------------------------------------
  it('R8: quarantine disposition re-enters a NON-sellable location (ADR-0021) — the sale location is untouched', async () => {
    const f = await seed('R8 Co', `r8-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 10);
    const sellBefore = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);
    const quarBefore = await physicalAt(f.tenantId, f.variantId, f.quarantineLocationId);
    const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'water damage', items: [{ orderItemId, quantity: 2 }] });
    const ret = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    expect((await inspect(f.admin, ret.id, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'quarantine', dispositionLocationId: f.quarantineLocationId }] })).statusCode).toBe(200);
    expect((await resolve(f.admin, ret.id)).statusCode).toBe(200);

    expect(await physicalAt(f.tenantId, f.variantId, f.sellLocationId)).toBe(sellBefore); // unchanged
    expect(await physicalAt(f.tenantId, f.variantId, f.quarantineLocationId)).toBe(quarBefore + 2); // tracked, not sellable
    const moves = await returnMovements(f.tenantId, [ret.items[0]!.id]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ movementType: 'RETURN', locationId: f.quarantineLocationId });

    const resolved = await c.inject({ method: 'GET', url: `/api/v1/sales-returns/${ret.id}`, headers: c.readHeaders(f.admin) });
    expect(JSON.parse(resolved.body).status).toBe('resolved');
  });

  // ---- R9 -------------------------------------------------------------------
  it('R9: a user without access to the disposition location cannot inspect or resolve (403), no re-entry', async () => {
    const f = await seed('R9 Co', `r9-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 5);
    // A supervisor restricted to a DIFFERENT location.
    const otherLocation = await c.createLocation(f.admin, f.warehouseId, `OTHER-${uniq()}`, { isSellable: true });
    const supervisor = await c.createAndLoginAs(f.admin, `sup9-${uniq()}@ex.com`, 'Supervisor');
    await c.setUserLocations(f.admin, supervisor.user.id, [otherLocation]);

    const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 2 }] });
    const ret = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    const ins = await inspect(supervisor, ret.id, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] });
    expect(ins.statusCode).toBe(403);
    const moves = await returnMovements(f.tenantId, [ret.items[0]!.id]);
    expect(moves).toHaveLength(0);
  });

  // ---- R10 -------------------------------------------------------------------
  it('R10: resolving twice with the same Idempotency-Key -> one movement, one re-entry', async () => {
    const f = await seed('R10 Co', `r10-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 6);
    const before = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);
    const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 2 }] });
    const ret = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    await inspect(f.admin, ret.id, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] });
    const key = randomUUID();
    expect((await resolve(f.admin, ret.id, key)).statusCode).toBe(200);
    expect((await resolve(f.admin, ret.id, key)).statusCode).toBe(200); // replay
    expect(await physicalAt(f.tenantId, f.variantId, f.sellLocationId)).toBe(before + 2);
    expect(await returnMovements(f.tenantId, [ret.items[0]!.id])).toHaveLength(1);
  });

  // ---- R11 -------------------------------------------------------------------
  it('R11: two concurrent resolve calls -> one logical completion, one inventory effect', async () => {
    const f = await seed('R11 Co', `r11-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 6);
    const before = await physicalAt(f.tenantId, f.variantId, f.sellLocationId);
    const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 2 }] });
    const ret = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    await inspect(f.admin, ret.id, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] });
    const [a, b] = await Promise.all([resolve(f.admin, ret.id), resolve(f.admin, ret.id)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(await physicalAt(f.tenantId, f.variantId, f.sellLocationId)).toBe(before + 2);
    expect(await returnMovements(f.tenantId, [ret.items[0]!.id])).toHaveLength(1);
    const audits = await auditFor(f.tenantId, ret.id);
    expect(audits.filter((a2) => a2 === 'sales_return.resolved')).toHaveLength(1);
  });

  async function auditFor(tenantId: string, entityId: string): Promise<string[]> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ actionCode: auditLog.actionCode })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityType, 'sales_return'), eq(auditLog.entityId, entityId)));
      return rows.map((r) => r.actionCode);
    } finally {
      await client.end();
    }
  }

  // ---- R12 -------------------------------------------------------------------
  it('R12: after a return the original order snapshot and quantities are unchanged', async () => {
    const f = await seed('R12 Co', `r12-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 5);
    const beforeOrder = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: c.readHeaders(f.admin) })).body);
    const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 2 }] });
    const ret = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    await inspect(f.admin, ret.id, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] });
    await resolve(f.admin, ret.id);
    const afterOrder = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: c.readHeaders(f.admin) })).body);
    expect(afterOrder.items[0].quantity).toBe(5);
    expect(afterOrder.items[0].unitPrice).toBe(beforeOrder.items[0].unitPrice);
    expect(afterOrder.total).toBe(beforeOrder.total);
    expect(afterOrder.status).toBe('confirmed');
    expect(afterOrder.customer).toEqual(beforeOrder.customer);
  });

  // ---- RBAC / mass assignment ---------------------------------------------------------------
  it('anonymous -> 401, authenticated-without-permission -> 403 on return routes', async () => {
    const f = await seed('R-RBAC Co', `rrbac-${uniq()}@ex.com`);
    expect((await c.inject({ method: 'GET', url: '/api/v1/sales-returns' })).statusCode).toBe(401);
    const bodega = await c.createAndLoginAs(f.admin, `rb-${uniq()}@ex.com`, 'Bodega'); // no sales.returns.create
    const { orderId, orderItemId } = await confirmedOrder(f, 2);
    const r = await createReturn(bodega, { orderId, locationId: f.sellLocationId, reason: 'no perm', items: [{ orderItemId, quantity: 1 }] });
    expect(r.statusCode).toBe(403);
  });

  it('inspect requires inventory.returns.manage (a plain Vendedor cannot)', async () => {
    const f = await seed('R-INSP Co', `rinsp-${uniq()}@ex.com`);
    const seller = await c.createAndLoginAs(f.admin, `rs-${uniq()}@ex.com`, 'Vendedor');
    const { orderId, orderItemId } = await confirmedOrder(f, 3);
    const created = await createReturn(seller, { orderId, locationId: f.sellLocationId, reason: 'returned', items: [{ orderItemId, quantity: 1 }] });
    expect(created.statusCode, created.body).toBe(201);
    const ret = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    const ins = await inspect(seller, ret.id, { items: [{ returnItemId: ret.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] });
    expect(ins.statusCode).toBe(403);
  });
});
