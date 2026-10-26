import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OutboxRepository } from '../../src/common/events/outbox.repository';
import { auditLog, eventOutbox } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * FASE 14 — the transactional-outbox guarantee, end to end against real PostgreSQL (§26/§40/§186):
 * the `event_outbox` row and the business mutation commit or roll back together. No mocks for the
 * DB; the one place a fake is used is forcing an outbox INSERT failure to prove the business
 * transaction unwinds with it.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('events: transactional outbox (integration)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
  }, 60_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (app) await app.close();
  });

  interface Fixture {
    admin: Session;
    tenantId: string;
    warehouseId: string;
    locationId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    await c.receiveStock(admin, variantId, locationId, 50);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, tenantId: admin.user.tenantId, warehouseId, locationId, variantId, customerId };
  }

  async function pendingOrder(f: Fixture, quantity = 2): Promise<string> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity } });
    expect(added.statusCode, added.body).toBe(200);
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    return (JSON.parse(order.body) as { id: string }).id;
  }

  // Owner redesign: the payment method is now picked at confirm, not at order creation —
  // `amount` defaults to 200 (the default `pendingOrder()` fixture: 2 units @ basePrice 100).
  const confirm = (f: Fixture, orderId: string, session: Session = f.admin, amount = 200) =>
    c.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/confirm`,
      headers: c.writeHeaders(session),
      payload: { payments: [{ paymentMethod: 'cash', amount }] },
    });

  async function outboxRows(tenantId: string, aggregateId: string) {
    const { client, db } = getMigratorDb();
    try {
      return await db
        .select()
        .from(eventOutbox)
        .where(and(eq(eventOutbox.tenantId, tenantId), eq(eventOutbox.aggregateId, aggregateId)));
    } finally {
      await client.end();
    }
  }

  async function saleMovementCount(tenantId: string, orderId: string): Promise<number> {
    const { client } = getMigratorDb();
    try {
      const rows = await client<{ c: string }[]>`
        select count(*)::text as c from inventory_movements
        where tenant_id = ${tenantId} and reference_type = 'order' and reference_id = ${orderId} and movement_type = 'SALE'`;
      return Number(rows[0]?.c ?? 0);
    } finally {
      await client.end();
    }
  }

  it('business commit -> exactly one matching outbox row, in the same transaction (§97)', async () => {
    const f = await seed('Outbox Commit Co', 'admin@outbox-commit.example');
    const orderId = await pendingOrder(f);
    expect((await confirm(f, orderId)).statusCode).toBe(200);

    const rows = await outboxRows(f.tenantId, orderId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.eventType).toBe('sales.order.confirmed');
    expect(row.aggregateType).toBe('order');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.processedAt).toBeNull();
    const payload = row.payload as { eventId: string; eventVersion: number; data: { orderId: string; total: number } };
    expect(payload.eventId).toBe(row.id);
    expect(payload.eventVersion).toBe(1);
    expect(payload.data.orderId).toBe(orderId);
  });

  it('a second (idempotent) confirm does NOT create a second event (§16/§35/§99)', async () => {
    const f = await seed('Outbox Idem Co', 'admin@outbox-idem.example');
    const orderId = await pendingOrder(f);
    expect((await confirm(f, orderId)).statusCode).toBe(200);
    expect((await confirm(f, orderId)).statusCode).toBe(200);
    expect((await confirm(f, orderId)).statusCode).toBe(200);
    expect(await outboxRows(f.tenantId, orderId)).toHaveLength(1);
  });

  it('business rollback -> no outbox row (§40/§98)', async () => {
    const f = await seed('Outbox Rollback Co', 'admin@outbox-rollback.example');
    // A Vendedor restricted to a different location: confirm() takes the order lock, then
    // LocationAuthorizationService.assertAccess throws — the whole withTenantTransaction rolls back,
    // event publish included.
    const otherLocation = await c.createLocation(f.admin, f.warehouseId, `LB-${Date.now()}`);
    // The actor must pass the seller-scope check (FINDING-VA-WRITE-SCOPE: a seller without `sales.orders.view_all` cannot
    // even see — hence cannot confirm — an order another user placed) so that the failure under test is still the
    // LOCATION authorization, not the seller scope.
    await c.createRole(f.admin, 'Vendedor vista total', [...new Set([...DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes, 'sales.orders.view_all'])]);
    const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@outbox-rollback.example', 'Vendedor vista total');
    await c.setUserLocations(f.admin, vendedor.user.id, [otherLocation]);

    const orderId = await pendingOrder(f);
    expect((await confirm(f, orderId, vendedor)).statusCode).toBe(403);

    expect(await outboxRows(f.tenantId, orderId)).toHaveLength(0);
    expect(await saleMovementCount(f.tenantId, orderId)).toBe(0);
  });

  it('outbox INSERT failure -> the business transaction rolls back (§27/§153/§186)', async () => {
    const f = await seed('Outbox Fail Co', 'admin@outbox-fail.example');
    const orderId = await pendingOrder(f);

    const outboxRepository = app.get(OutboxRepository);
    const spy = vi.spyOn(outboxRepository, 'append').mockRejectedValueOnce(new Error('simulated outbox INSERT failure'));

    const res = await confirm(f, orderId);
    expect(res.statusCode).toBe(500);
    expect(spy).toHaveBeenCalledOnce();

    // Nothing committed: order still pending, no SALE, no event.
    const status = await c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: c.readHeaders(f.admin) });
    expect((JSON.parse(status.body) as { status: string }).status).toBe('pending');
    expect(await saleMovementCount(f.tenantId, orderId)).toBe(0);
    expect(await outboxRows(f.tenantId, orderId)).toHaveLength(0);

    // And a real retry now succeeds, producing exactly one event.
    expect((await confirm(f, orderId)).statusCode).toBe(200);
    expect(await outboxRows(f.tenantId, orderId)).toHaveLength(1);
  });

  it('audit row and outbox row are two distinct records (§34/§109)', async () => {
    const f = await seed('Outbox vs Audit Co', 'admin@outbox-audit.example');
    const orderId = await pendingOrder(f);
    expect((await confirm(f, orderId)).statusCode).toBe(200);

    const { client, db } = getMigratorDb();
    try {
      const audits = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.entityType, 'order'), eq(auditLog.entityId, orderId), eq(auditLog.actionCode, 'order.confirmed')));
      const events = await db
        .select()
        .from(eventOutbox)
        .where(and(eq(eventOutbox.tenantId, f.tenantId), eq(eventOutbox.aggregateId, orderId)));
      expect(audits).toHaveLength(1);
      expect(events).toHaveLength(1);
      expect(audits[0]!.id).not.toBe(events[0]!.id);
    } finally {
      await client.end();
    }
  });
});
