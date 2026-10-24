import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv } from '../sales/sales-harness';

/**
 * `GET /inventory/movements` — the "Motivo / referencia" column shows the NAME of the document a
 * movement belongs to, never `order 01a16b4d…`: "Pedido #ORD-…" for the reservation, "Venta #ORD-…"
 * for the sale, "Devolución #DEV-…" for a return. Real PostgreSQL, real order + return lifecycle.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('inventory movements: reference names (integration)', () => {
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

  it('labels the reservation, the sale and the return with the document numbers', async () => {
    const admin = await c.registerTenant(`Co ${uniq()}`, `mov-ref-${uniq()}@example.com`);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`, { isSellable: true });
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, basePrice: 100, maxPrice: 100, minPrice: 100 });
    await c.receiveStock(admin, variantId, locationId, 10);
    const customerId = await c.createCustomer(admin, c.fullCustomer('movref'));

    const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(admin), payload: { locationId, customerId } });
    const cartId = (JSON.parse(cart.body) as { id: string }).id;
    await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(admin), payload: { productVariantId: variantId, quantity: 2 } });
    const created = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = JSON.parse(created.body) as { id: string; orderNumber: string; items: { id: string }[] };
    const confirmed = await c.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/confirm`,
      headers: c.writeHeaders(admin),
      payload: { payments: [{ paymentMethod: 'cash', amount: 200 }] },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    // one unit comes back and is restocked → a RETURN movement
    const ret = await c.inject({
      method: 'POST',
      url: '/api/v1/sales-returns',
      headers: c.writeHeaders(admin, { 'idempotency-key': randomUUID() }),
      payload: { orderId: order.id, locationId, reason: 'integration', items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] },
    });
    expect(ret.statusCode, ret.body).toBe(201);
    const returnBody = JSON.parse(ret.body) as { id: string; returnNumber: string; items: { id: string }[] };
    const inspected = await c.inject({
      method: 'POST',
      url: `/api/v1/sales-returns/${returnBody.id}/inspect`,
      headers: c.writeHeaders(admin),
      payload: { items: returnBody.items.map((item) => ({ returnItemId: item.id, disposition: 'restock', dispositionLocationId: locationId })) },
    });
    expect(inspected.statusCode, inspected.body).toBe(200);
    const resolved = await c.inject({ method: 'POST', url: `/api/v1/sales-returns/${returnBody.id}/resolve`, headers: c.writeHeaders(admin, { 'idempotency-key': randomUUID() }) });
    expect(resolved.statusCode, resolved.body).toBe(200);

    const list = await c.inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}&pageSize=100`, headers: c.readHeaders(admin) });
    expect(list.statusCode, list.body).toBe(200);
    const movements = (JSON.parse(list.body) as { data: { movementType: string; referenceLabel?: string; reason?: string }[] }).data;
    const labelOf = (type: string) => movements.filter((m) => m.movementType === type).map((m) => m.referenceLabel);

    expect(labelOf('RESERVATION')).toEqual([`Pedido #${order.orderNumber}`]);
    expect(labelOf('RESERVATION_RELEASE')).toEqual([`Pedido #${order.orderNumber}`]);
    expect(labelOf('SALE')).toEqual([`Venta #${order.orderNumber}`]);
    expect(labelOf('RETURN')).toEqual([`Devolución #${returnBody.returnNumber}`]);
  });
});
