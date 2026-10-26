import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLog,
  cartItems,
  eventOutbox,
  idempotencyKeys,
  inventoryBalances,
  inventoryMovements,
  orderItems,
  orders,
  productVariants,
} from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * MVP scope decision (owner, 2026-10-26): serialized / lot-tracked variants are NOT sellable and
 * keep being rejected with HTTP 422. Rejecting is not enough on its own — every rejection path must
 * also leave NO side effect: no order / order item, no reservation (movement or balance), no
 * idempotency record, no audit row and no `event_outbox` row (hence no notification). Counts are
 * read straight from the database before and after, never inferred from the HTTP response. No mocks.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: serialized / lot-tracked variants are rejected without side effects (integration)', () => {
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
    locationId: string;
    customerId: string;
    normalVariantId: string;
    otherNormalVariantId: string;
    serialVariantId: string;
    lotVariantId: string;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
    const price = { maxPrice: 120, basePrice: 100, minPrice: 80 };
    const normal = await c.createProductVariant(admin, { sku: `N-${uniq()}`, ...price });
    const otherNormal = await c.createProductVariant(admin, { sku: `N2-${uniq()}`, ...price });
    const serial = await c.createProductVariant(admin, { sku: `S-${uniq()}`, isSerialized: true, ...price });
    const lot = await c.createProductVariant(admin, { sku: `LOT-${uniq()}`, isLotTracked: true, ...price });
    await c.receiveStock(admin, normal.variantId, locationId, 10);
    await c.receiveStock(admin, otherNormal.variantId, locationId, 10);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return {
      admin,
      tenantId: admin.user.tenantId,
      locationId,
      customerId,
      normalVariantId: normal.variantId,
      otherNormalVariantId: otherNormal.variantId,
      serialVariantId: serial.variantId,
      lotVariantId: lot.variantId,
    };
  }

  interface Snapshot {
    orders: number;
    orderItems: number;
    cartItems: number;
    movements: number;
    reserved: number;
    outbox: number;
    idempotency: number;
    audit: number;
  }

  /** Every table a sale could touch, counted for one tenant. */
  async function snapshot(f: Fixture): Promise<Snapshot> {
    const { client, db } = getMigratorDb();
    try {
      const count = async (table: typeof orders | typeof orderItems | typeof cartItems | typeof inventoryMovements | typeof eventOutbox | typeof idempotencyKeys | typeof auditLog): Promise<number> => {
        const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.tenantId, f.tenantId));
        return row?.n ?? 0;
      };
      const [reservedRow] = await db
        .select({ n: sql<number>`coalesce(sum(${inventoryBalances.quantityReserved}), 0)::float` })
        .from(inventoryBalances)
        .where(eq(inventoryBalances.tenantId, f.tenantId));
      return {
        orders: await count(orders),
        orderItems: await count(orderItems),
        cartItems: await count(cartItems),
        movements: await count(inventoryMovements),
        reserved: reservedRow?.n ?? 0,
        outbox: await count(eventOutbox),
        idempotency: await count(idempotencyKeys),
        audit: await count(auditLog),
      };
    } finally {
      await client.end();
    }
  }

  /** Test-only: flips a variant's tracking flag as if it had been reclassified after being carted. */
  async function setSerialized(variantId: string, value: boolean): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      await db.update(productVariants).set({ isSerialized: value }).where(eq(productVariants.id, variantId));
    } finally {
      await client.end();
    }
  }

  async function openCart(f: Fixture): Promise<string> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    return (JSON.parse(created.body) as { id: string }).id;
  }

  const addItem = (f: Fixture, productVariantId: string, quantity = 1) =>
    c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId, quantity } });

  const checkout = (f: Fixture, cartId: string, key: string) =>
    c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': key }),
      payload: { cartId, documentType: 'sales_note' },
    });

  it('adding a serialized or a lot-tracked variant to the cart is 422 and changes nothing', async () => {
    const f = await seed('Ser Cart Co', `ser-cart-${uniq()}@ex.com`);
    await openCart(f);
    const before = await snapshot(f);

    const serial = await addItem(f, f.serialVariantId);
    expect(serial.statusCode, serial.body).toBe(422);
    const lot = await addItem(f, f.lotVariantId);
    expect(lot.statusCode, lot.body).toBe(422);

    expect(await snapshot(f)).toEqual(before);
  });

  it('a rejected add leaves a cart that already holds a normal line exactly as it was', async () => {
    const f = await seed('Ser Mixed Co', `ser-mixed-${uniq()}@ex.com`);
    await openCart(f);
    expect((await addItem(f, f.normalVariantId, 2)).statusCode).toBe(200);
    const before = await snapshot(f);

    expect((await addItem(f, f.serialVariantId)).statusCode).toBe(422);

    const after = await snapshot(f);
    expect(after).toEqual(before);
    expect(after.cartItems).toBe(1);
  });

  it('checkout of a cart whose variant became serialized is 422: no order, no reservation, no idempotency record, no event, no audit', async () => {
    const f = await seed('Ser Checkout Co', `ser-co-${uniq()}@ex.com`);
    const cartId = await openCart(f);
    // Line A stays normal and WOULD have been reserved; line B is reclassified after being carted.
    expect((await addItem(f, f.normalVariantId, 3)).statusCode).toBe(200);
    expect((await addItem(f, f.otherNormalVariantId, 2)).statusCode).toBe(200);
    await setSerialized(f.otherNormalVariantId, true);
    const before = await snapshot(f);

    const key = randomUUID();
    const rejected = await checkout(f, cartId, key);
    expect(rejected.statusCode, rejected.body).toBe(422);

    // Nothing at all moved — in particular line A was NOT reserved (the whole checkout rolled back).
    expect(await snapshot(f)).toEqual(before);

    // The Idempotency-Key was not burned: once the variant is sellable again, the SAME key succeeds.
    await setSerialized(f.otherNormalVariantId, false);
    const retried = await checkout(f, cartId, key);
    expect(retried.statusCode, retried.body).toBe(201);
    const after = await snapshot(f);
    expect(after.orders).toBe(before.orders + 1);
    expect(after.orderItems).toBe(before.orderItems + 2);
    expect(after.reserved).toBe(before.reserved + 5);
  });

  it('a lot-tracked or serialized variant never produces a notification event', async () => {
    const f = await seed('Ser Outbox Co', `ser-out-${uniq()}@ex.com`);
    await openCart(f);
    const before = await snapshot(f);
    await addItem(f, f.serialVariantId);
    await addItem(f, f.lotVariantId);
    expect((await snapshot(f)).outbox).toBe(before.outbox);
  });
});
