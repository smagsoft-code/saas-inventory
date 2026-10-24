import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv } from './sales-harness';

/**
 * Regression: a browser that opened the app over plain http had no `crypto.randomUUID` and sent
 * `Correlation-Id: web-<time>-<random>`. `orders.correlation_id` is a uuid column, so creating an
 * order answered 500 ("invalid input syntax for type uuid"). The id is now only trusted when it is
 * a UUID; anything else is replaced, the order is created and the response carries a valid one.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: a non-UUID Correlation-Id never breaks order creation (integration)', () => {
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
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function checkoutWith(correlationId: string | undefined): Promise<{ statusCode: number; correlationHeader: string | undefined; body: string }> {
    const admin = await c.registerTenant(`Co ${uniq()}`, `corr-${uniq()}@example.com`);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`, { isSellable: true });
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, basePrice: 100, maxPrice: 100, minPrice: 100 });
    await c.receiveStock(admin, variantId, locationId, 10);
    const customerId = await c.createCustomer(admin, c.fullCustomer('corr'));
    const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(admin), payload: { locationId, customerId } });
    const cartId = (JSON.parse(cart.body) as { id: string }).id;
    await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(admin), payload: { productVariantId: variantId, quantity: 1 } });
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(admin, { 'idempotency-key': randomUUID(), ...(correlationId ? { 'correlation-id': correlationId } : {}) }),
      payload: { cartId, documentType: 'sales_note' },
    });
    return { statusCode: res.statusCode, correlationHeader: res.headers['correlation-id'] as string | undefined, body: res.body };
  }

  it('creates the order when the client sends the old browser fallback id, and answers with a valid UUID', async () => {
    const res = await checkoutWith(`web-${Date.now()}-a30d1c8beb6b7`);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.correlationHeader).toMatch(UUID);
  });

  it('a valid UUID from the client is kept and echoed', async () => {
    const mine = randomUUID();
    const res = await checkoutWith(mine);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.correlationHeader).toBe(mine);
  });

  it('no header at all still works (one is generated)', async () => {
    const res = await checkoutWith(undefined);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.correlationHeader).toMatch(UUID);
  });
});
