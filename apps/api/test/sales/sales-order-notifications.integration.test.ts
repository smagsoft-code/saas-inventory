import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * F17-10 — `GET /orders/:id/notifications` (closing `GAP-NOTIF-STATUS`). Read-only projection of the
 * order's `event_outbox` rows. `app_tenant` has held `SELECT` on `event_outbox` since migration
 * 0010; this is the first application read. No mocks — real PostgreSQL, real `event_outbox` rows
 * written by `OrdersService.confirm`'s `DomainEventPublisher.append`.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: order notification status (integration, F17-10)', () => {
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
    locationId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, locationId, 20);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, locationId, variantId, customerId };
  }

  async function pendingOrder(f: Fixture, session: Session): Promise<string> {
    const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(session), payload: { locationId: f.locationId, customerId: f.customerId } });
    const cartId = (JSON.parse(cart.body) as { id: string }).id;
    await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(session), payload: { productVariantId: f.variantId, quantity: 1 } });
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(session, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    return (JSON.parse(order.body) as { id: string }).id;
  }

  const notifications = (session: Session, orderId: string) =>
    c.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/notifications`, headers: c.readHeaders(session) });

  it('a pending order (no domain event yet) reports overallStatus "none" and no events', async () => {
    const f = await seed('NOTIF none', `notif-none-${uniq()}@ex.com`);
    const orderId = await pendingOrder(f, f.admin);
    const res = await notifications(f.admin, orderId);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { orderId: string; overallStatus: string; events: unknown[] };
    expect(body.orderId).toBe(orderId);
    expect(body.overallStatus).toBe('none');
    expect(body.events).toEqual([]);
  });

  it('after confirm, the sales.order.confirmed event is listed (pending — nothing delivers it in tests)', async () => {
    const f = await seed('NOTIF confirmed', `notif-ok-${uniq()}@ex.com`);
    const orderId = await pendingOrder(f, f.admin);
    expect(
      (
        await c.inject({
          method: 'POST',
          url: `/api/v1/orders/${orderId}/confirm`,
          headers: c.writeHeaders(f.admin),
          payload: { payments: [{ paymentMethod: 'cash', amount: 100 }] },
        })
      ).statusCode,
    ).toBe(200);

    const body = JSON.parse((await notifications(f.admin, orderId)).body) as {
      overallStatus: string;
      events: { eventId: string; eventType: string; status: string; attempts: number; occurredAt: string }[];
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.eventType).toBe('sales.order.confirmed');
    expect(body.events[0]!.status).toBe('pending');
    expect(body.events[0]!.attempts).toBe(0);
    expect(body.overallStatus).toBe('pending');
    // Never leaks the payload / worker internals.
    expect(Object.keys(body.events[0]!)).not.toContain('payload');
    expect(Object.keys(body.events[0]!)).not.toContain('lastError');
  });

  it('requires sales.orders.view — a Bodega user is 403', async () => {
    const f = await seed('NOTIF rbac', `notif-rbac-${uniq()}@ex.com`);
    const orderId = await pendingOrder(f, f.admin);
    const bodega = await c.createAndLoginAs(f.admin, `notif-bod-${uniq()}@ex.com`, 'Bodega');
    expect((await notifications(bodega, orderId)).statusCode).toBe(403);
  });

  it('never crosses tenants — tenant B gets 404 for tenant A\'s order', async () => {
    const a = await seed('NOTIF A', `notif-a-${uniq()}@ex.com`);
    const b = await seed('NOTIF B', `notif-b-${uniq()}@ex.com`);
    const orderId = await pendingOrder(a, a.admin);
    expect((await notifications(b.admin, orderId)).statusCode).toBe(404);
  });
});
