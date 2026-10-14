import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventOutbox } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * FASE 14 — every SALES state transition publishes exactly one domain event, and no more, even
 * under HTTP retry / concurrent transitions (§35-§39, §99-§108, §129). Payloads are checked for
 * ADR-0028 data minimisation (§32). Real PostgreSQL; events are read straight from `event_outbox`.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('events: SALES producers (integration)', () => {
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
    supervisor: Session;
    tenantId: string;
    warehouseId: string;
    sellLocationId: string;
    quarantineLocationId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const supervisor = await c.createAndLoginAs(admin, `sup-${uniq()}@ex.com`, 'Supervisor');
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const sellLocationId = await c.createLocation(admin, warehouseId, `SELL-${uniq()}`, { isSellable: true });
    const quarantineLocationId = await c.createLocation(admin, warehouseId, `QUAR-${uniq()}`, { isSellable: false });
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, sellLocationId, 200);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, supervisor, tenantId: admin.user.tenantId, warehouseId, sellLocationId, quarantineLocationId, variantId, customerId };
  }

  async function pendingOrder(f: Fixture, opts: { quantity?: number; unitPrice?: number } = {}): Promise<{ orderId: string; orderItemId: string; isExceptional: boolean }> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.sellLocationId, customerId: f.customerId } });
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    await c.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: c.writeHeaders(f.admin),
      payload: { productVariantId: f.variantId, quantity: opts.quantity ?? 2, ...(opts.unitPrice === undefined ? {} : { negotiatedUnitPrice: opts.unitPrice }) },
    });
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    const body = JSON.parse(order.body) as { id: string; items: { id: string; isExceptionalDiscount: boolean }[] };
    return { orderId: body.id, orderItemId: body.items[0]!.id, isExceptional: body.items[0]!.isExceptionalDiscount };
  }

  async function confirmedOrder(f: Fixture, quantity: number): Promise<{ orderId: string; orderItemId: string }> {
    const { orderId, orderItemId } = await pendingOrder(f, { quantity });
    expect((await confirm(f, orderId, quantity * 100)).statusCode).toBe(200);
    return { orderId, orderItemId };
  }

  // Owner redesign: the payment method is now picked at confirm, not at order creation —
  // `amount` defaults to 200 (the default `pendingOrder()` fixture: 2 units @ basePrice 100).
  const confirm = (f: Fixture, orderId: string, amount = 200) =>
    c.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/confirm`,
      headers: c.writeHeaders(f.admin),
      payload: { payments: [{ paymentMethod: 'cash', amount }] },
    });
  const cancel = (f: Fixture, orderId: string) => c.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: c.writeHeaders(f.admin) });

  interface OutboxRow {
    id: string;
    eventType: string;
    aggregateType: string;
    payload: Record<string, unknown>;
  }

  async function events(tenantId: string, aggregateId: string): Promise<OutboxRow[]> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ id: eventOutbox.id, eventType: eventOutbox.eventType, aggregateType: eventOutbox.aggregateType, payload: eventOutbox.payload })
        .from(eventOutbox)
        .where(and(eq(eventOutbox.tenantId, tenantId), eq(eventOutbox.aggregateId, aggregateId)))
        .orderBy(eventOutbox.createdAt);
      return rows as OutboxRow[];
    } finally {
      await client.end();
    }
  }
  const types = (rows: OutboxRow[]) => rows.map((r) => r.eventType);

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------
  it('order.confirmed: one event on pending -> confirmed, autosufficient payload, NO min/cost fields (§16/§30/§32)', async () => {
    const f = await seed('EV Confirm Co', `ev-confirm-${uniq()}@ex.com`);
    // 110 is >= base_price (100) — a normal, non-exceptional line under the owner's policy
    // change, so confirm below needs no approval.
    const { orderId } = await pendingOrder(f, { quantity: 3, unitPrice: 110 });
    expect((await confirm(f, orderId, 330)).statusCode).toBe(200);

    const rows = await events(f.tenantId, orderId);
    expect(types(rows)).toEqual(['sales.order.confirmed']);
    const data = rows[0]!.payload['data'] as Record<string, unknown>;
    expect(data['orderId']).toBe(orderId);
    expect(data['total']).toBe(330);
    expect(data['currency']).toBe('USD');
    expect((data['customer'] as Record<string, unknown>)['name']).toContain('Customer');
    const line = (data['lines'] as Record<string, unknown>[])[0]!;
    expect(line).toHaveProperty('unitPrice', 110);
    expect(line).not.toHaveProperty('minPrice');
    expect(line).not.toHaveProperty('unitCost');
    expect(line).not.toHaveProperty('basePrice');
    expect(line).not.toHaveProperty('maxPrice');
    // whole payload must not leak the floor / cost anywhere
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/minPrice|unitCost|"cost"/i);
  });

  it('order.confirmed: an idempotent second confirm emits nothing (§35/§99)', async () => {
    const f = await seed('EV Confirm Idem Co', `ev-confirm-idem-${uniq()}@ex.com`);
    const { orderId } = await pendingOrder(f);
    await confirm(f, orderId);
    await confirm(f, orderId);
    expect(types(await events(f.tenantId, orderId))).toEqual(['sales.order.confirmed']);
  });

  it('order.cancelled: one event on pending -> cancelled; a second cancel emits nothing (§100)', async () => {
    const f = await seed('EV Cancel Co', `ev-cancel-${uniq()}@ex.com`);
    const { orderId } = await pendingOrder(f);
    expect((await cancel(f, orderId)).statusCode).toBe(200);
    expect((await cancel(f, orderId)).statusCode).toBe(200);
    expect(types(await events(f.tenantId, orderId))).toEqual(['sales.order.cancelled']);
  });

  it('confirm || confirm -> exactly one order.confirmed event (§37/§99)', async () => {
    const f = await seed('EV Confirm Race Co', `ev-confirm-race-${uniq()}@ex.com`);
    const { orderId } = await pendingOrder(f);
    const [a, b] = await Promise.all([confirm(f, orderId), confirm(f, orderId)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 200]);
    expect(types(await events(f.tenantId, orderId))).toEqual(['sales.order.confirmed']);
  });

  it('confirm || cancel -> exactly one event, matching the winner (§37)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const f = await seed(`EV CC Race ${i} Co`, `ev-cc-${i}-${uniq()}@ex.com`);
      const { orderId } = await pendingOrder(f);
      const [cf, cn] = await Promise.all([confirm(f, orderId), cancel(f, orderId)]);
      expect([cf.statusCode, cn.statusCode].sort()).toEqual([200, 409]);
      const finalStatus = (JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: c.readHeaders(f.admin) })).body) as { status: string }).status;
      const evs = types(await events(f.tenantId, orderId));
      expect(evs).toEqual([finalStatus === 'confirmed' ? 'sales.order.confirmed' : 'sales.order.cancelled']);
    }
  });

  // ---------------------------------------------------------------------------
  // Price approvals
  // ---------------------------------------------------------------------------
  it('price_approval.requested / approved: one event each; minPriceAtRequest is NOT in either payload (§17/§32/§101/§102)', async () => {
    const f = await seed('EV Approval Co', `ev-approval-${uniq()}@ex.com`);
    const { orderId, orderItemId, isExceptional } = await pendingOrder(f, { quantity: 1, unitPrice: 70 });
    expect(isExceptional).toBe(true);

    const requested = await c.inject({ method: 'POST', url: '/api/v1/price-approvals', headers: c.writeHeaders(f.admin), payload: { orderItemId, reason: 'loyal customer' } });
    expect(requested.statusCode, requested.body).toBe(201);
    const approvalId = (JSON.parse(requested.body) as { id: string }).id;

    let rows = await events(f.tenantId, approvalId);
    expect(types(rows)).toEqual(['sales.price_approval.requested']);
    const reqData = rows[0]!.payload['data'] as Record<string, unknown>;
    expect(reqData['orderId']).toBe(orderId);
    expect(reqData['requestedPrice']).toBe(70);
    expect(reqData).not.toHaveProperty('minPriceAtRequest');
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/minPrice/i);

    const approved = await c.inject({ method: 'POST', url: `/api/v1/price-approvals/${approvalId}/approve`, headers: c.writeHeaders(f.supervisor) });
    expect(approved.statusCode, approved.body).toBe(200);

    rows = await events(f.tenantId, approvalId);
    expect(types(rows)).toEqual(['sales.price_approval.requested', 'sales.price_approval.approved']);
    const apprData = rows[1]!.payload['data'] as Record<string, unknown>;
    expect(apprData['status']).toBe('approved');
    expect(apprData['resolvedByUserId']).toBe(f.supervisor.user.id);
    expect(apprData['requestedByUserId']).toBe(f.admin.user.id);

    // a second approve is idempotent — no third event
    await c.inject({ method: 'POST', url: `/api/v1/price-approvals/${approvalId}/approve`, headers: c.writeHeaders(f.supervisor) });
    expect(types(await events(f.tenantId, approvalId))).toHaveLength(2);
  });

  it('approve || reject -> exactly one resolution event, matching the winner; never both (§103)', async () => {
    for (let i = 0; i < 4; i += 1) {
      const f = await seed(`EV AR Race ${i} Co`, `ev-ar-${i}-${uniq()}@ex.com`);
      const { orderItemId } = await pendingOrder(f, { quantity: 1, unitPrice: 70 });
      const requested = await c.inject({ method: 'POST', url: '/api/v1/price-approvals', headers: c.writeHeaders(f.admin), payload: { orderItemId, reason: 'race' } });
      const approvalId = (JSON.parse(requested.body) as { id: string }).id;

      const [ap, rj] = await Promise.all([
        c.inject({ method: 'POST', url: `/api/v1/price-approvals/${approvalId}/approve`, headers: c.writeHeaders(f.supervisor) }),
        c.inject({ method: 'POST', url: `/api/v1/price-approvals/${approvalId}/reject`, headers: c.writeHeaders(f.supervisor) }),
      ]);
      expect([ap.statusCode, rj.statusCode].sort()).toEqual([200, 409]);
      const final = (JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/price-approvals/${approvalId}`, headers: c.readHeaders(f.admin) })).body) as { status: string }).status;
      const resolution = types(await events(f.tenantId, approvalId)).filter((t) => t !== 'sales.price_approval.requested');
      expect(resolution).toEqual([final === 'approved' ? 'sales.price_approval.approved' : 'sales.price_approval.rejected']);
    }
  });

  // ---------------------------------------------------------------------------
  // Returns
  // ---------------------------------------------------------------------------
  it('return.requested: one event on create; a retry with the same Idempotency-Key emits nothing (§104)', async () => {
    const f = await seed('EV Return Req Co', `ev-return-req-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 4);
    const key = randomUUID();
    const payload = { orderId, locationId: f.sellLocationId, reason: 'defective', items: [{ orderItemId, quantity: 2 }] };
    const first = await c.inject({ method: 'POST', url: '/api/v1/sales-returns', headers: c.writeHeaders(f.admin, { 'idempotency-key': key }), payload });
    expect(first.statusCode, first.body).toBe(201);
    const returnId = (JSON.parse(first.body) as { id: string }).id;
    const retry = await c.inject({ method: 'POST', url: '/api/v1/sales-returns', headers: c.writeHeaders(f.admin, { 'idempotency-key': key }), payload });
    expect(retry.statusCode).toBe(201);

    expect(types(await events(f.tenantId, returnId))).toEqual(['sales.return.requested']);
  });

  it('return.resolved: one event on inspecting -> resolved, in the same tx as the RETURN movements (§105)', async () => {
    const f = await seed('EV Return Res Co', `ev-return-res-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 4);
    const created = await c.inject({ method: 'POST', url: '/api/v1/sales-returns', headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }), payload: { orderId, locationId: f.sellLocationId, reason: 'defective', items: [{ orderItemId, quantity: 2 }] } });
    const body = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    const returnId = body.id;
    await c.inject({ method: 'POST', url: `/api/v1/sales-returns/${returnId}/inspect`, headers: c.writeHeaders(f.admin), payload: { items: [{ returnItemId: body.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] } });
    const resolved = await c.inject({ method: 'POST', url: `/api/v1/sales-returns/${returnId}/resolve`, headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }) });
    expect(resolved.statusCode, resolved.body).toBe(200);

    const rows = await events(f.tenantId, returnId);
    expect(types(rows)).toEqual(['sales.return.requested', 'sales.return.resolved']);
    const data = rows[1]!.payload['data'] as Record<string, unknown>;
    expect((data['lines'] as Record<string, unknown>[])[0]!['disposition']).toBe('restock');
  });

  it('resolve || resolve -> exactly one return.resolved event (§107)', async () => {
    const f = await seed('EV Return ResRace Co', `ev-return-resrace-${uniq()}@ex.com`);
    const { orderId, orderItemId } = await confirmedOrder(f, 4);
    const created = await c.inject({ method: 'POST', url: '/api/v1/sales-returns', headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }), payload: { orderId, locationId: f.sellLocationId, reason: 'defective', items: [{ orderItemId, quantity: 2 }] } });
    const body = JSON.parse(created.body) as { id: string; items: { id: string }[] };
    await c.inject({ method: 'POST', url: `/api/v1/sales-returns/${body.id}/inspect`, headers: c.writeHeaders(f.admin), payload: { items: [{ returnItemId: body.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] } });

    const [a, b] = await Promise.all([
      c.inject({ method: 'POST', url: `/api/v1/sales-returns/${body.id}/resolve`, headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }) }),
      c.inject({ method: 'POST', url: `/api/v1/sales-returns/${body.id}/resolve`, headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }) }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 200]);
    expect(types(await events(f.tenantId, body.id)).filter((t) => t === 'sales.return.resolved')).toHaveLength(1);
  });

  it('resolve || cancel -> exactly one event, matching the winner (§108)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const f = await seed(`EV Return RC ${i} Co`, `ev-return-rc-${i}-${uniq()}@ex.com`);
      const { orderId, orderItemId } = await confirmedOrder(f, 4);
      const created = await c.inject({ method: 'POST', url: '/api/v1/sales-returns', headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }), payload: { orderId, locationId: f.sellLocationId, reason: 'defective', items: [{ orderItemId, quantity: 2 }] } });
      const body = JSON.parse(created.body) as { id: string; items: { id: string }[] };
      await c.inject({ method: 'POST', url: `/api/v1/sales-returns/${body.id}/inspect`, headers: c.writeHeaders(f.admin), payload: { items: [{ returnItemId: body.items[0]!.id, disposition: 'restock', dispositionLocationId: f.sellLocationId }] } });

      const [rs, cn] = await Promise.all([
        c.inject({ method: 'POST', url: `/api/v1/sales-returns/${body.id}/resolve`, headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }) }),
        c.inject({ method: 'POST', url: `/api/v1/sales-returns/${body.id}/cancel`, headers: c.writeHeaders(f.admin) }),
      ]);
      expect([rs.statusCode, cn.statusCode].sort()).toEqual([200, 409]);
      const final = (JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/sales-returns/${body.id}`, headers: c.readHeaders(f.admin) })).body) as { status: string }).status;
      const resolution = types(await events(f.tenantId, body.id)).filter((t) => t !== 'sales.return.requested');
      expect(resolution).toEqual([final === 'resolved' ? 'sales.return.resolved' : 'sales.return.cancelled']);
    }
  });

  it('every published event carries a versioned envelope and its id equals event_outbox.id (§19/§21)', async () => {
    const f = await seed('EV Envelope Co', `ev-envelope-${uniq()}@ex.com`);
    const { orderId } = await pendingOrder(f);
    await confirm(f, orderId);
    const rows = await events(f.tenantId, orderId);
    for (const row of rows) {
      expect(row.payload['eventId']).toBe(row.id);
      expect(row.payload['eventVersion']).toBe(1);
      expect(typeof row.payload['occurredAt']).toBe('string');
      expect(row.payload).toHaveProperty('actor');
    }
  });
});
