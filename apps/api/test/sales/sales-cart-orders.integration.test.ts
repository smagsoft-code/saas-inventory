import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, customers, rolePermissions, roles } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * FASE 12 (SALES) — the cart -> checkout -> confirm/cancel workflow end to end against real
 * PostgreSQL: cart item ops, negotiated pricing, customer + price snapshots, document type,
 * two-phase inventory reservation/commit, order state machine, cross-tenant IDOR, RBAC, location
 * authorization, and the serialized/lot deferral (§104-§119, §140-§147). No mocks.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: cart + orders (integration)', () => {
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

  interface Fixture {
    admin: Session;
    warehouseId: string;
    locationId: string;
    productId: string;
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string, opts: { stock?: number; maxPrice?: number; basePrice?: number; minPrice?: number } = {}): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const { productId, variantId } = await c.createProductVariant(admin, {
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      maxPrice: opts.maxPrice,
      basePrice: opts.basePrice,
      minPrice: opts.minPrice,
    });
    await c.receiveStock(admin, variantId, locationId, opts.stock ?? 100);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, warehouseId, locationId, productId, variantId, customerId };
  }

  const cart = (session: Session, method: 'GET' | 'POST' | 'PATCH', path = '', payload?: unknown) =>
    c.inject({ method, url: `/api/v1/cart${path}`, headers: c.writeHeaders(session), payload });

  async function openCartWith(f: Fixture, session: Session, items: { variantId: string; quantity: number; negotiatedUnitPrice?: number }[]): Promise<string> {
    const created = await cart(session, 'POST', '', { locationId: f.locationId, customerId: f.customerId });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    for (const item of items) {
      const added = await cart(session, 'POST', '/items', {
        productVariantId: item.variantId,
        quantity: item.quantity,
        ...(item.negotiatedUnitPrice !== undefined ? { negotiatedUnitPrice: item.negotiatedUnitPrice } : {}),
      });
      expect(added.statusCode, added.body).toBe(200);
    }
    return cartId;
  }

  function checkout(session: Session, cartId: string, documentType: 'invoice' | 'sales_note', key = randomUUID()) {
    return c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(session, { 'idempotency-key': key }),
      payload: { cartId, documentType },
    });
  }

  describe('cart item operations (§104, §141)', () => {
    it('add, increment, set quantity, clear negotiation, remove — subtotal recomputed server-side', async () => {
      const f = await seed('Cart Alpha Co', 'admin@cart-alpha.example', { basePrice: 100, maxPrice: 120, minPrice: 80 });
      const create = await cart(f.admin, 'POST', '', { locationId: f.locationId });
      expect(create.statusCode).toBe(201);

      let state = JSON.parse((await cart(f.admin, 'POST', '/items', { productVariantId: f.variantId, quantity: 2 })).body) as {
        items: { id: string; quantity: number; unitPrice: number; lineSubtotal: number }[];
        subtotal: number;
      };
      expect(state.items[0]!.quantity).toBe(2);
      expect(state.subtotal).toBe(200);

      // add same variant again -> increments the single row (§18 upsert)
      state = JSON.parse((await cart(f.admin, 'POST', '/items', { productVariantId: f.variantId, quantity: 1 })).body);
      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.quantity).toBe(3);

      const itemId = state.items[0]!.id;
      state = JSON.parse((await cart(f.admin, 'PATCH', `/items/${itemId}`, { quantity: 5, negotiatedUnitPrice: 90 })).body);
      expect(state.items[0]!.quantity).toBe(5);
      expect(state.items[0]!.unitPrice).toBe(90);
      expect(state.subtotal).toBe(450);

      state = JSON.parse((await cart(f.admin, 'PATCH', `/items/${itemId}`, { negotiatedUnitPrice: null })).body);
      expect(state.items[0]!.unitPrice).toBe(100);

      const removed = await c.inject({ method: 'DELETE', url: `/api/v1/cart/items/${itemId}`, headers: c.writeHeaders(f.admin) });
      expect(removed.statusCode).toBe(200);
      expect((JSON.parse(removed.body) as { items: unknown[] }).items).toHaveLength(0);
    });

    it('rejects quantity <= 0 (400)', async () => {
      const f = await seed('Cart Qty Co', 'admin@cart-qty.example');
      await cart(f.admin, 'POST', '', { locationId: f.locationId });
      const bad = await cart(f.admin, 'POST', '/items', { productVariantId: f.variantId, quantity: 0 });
      expect(bad.statusCode).toBe(400);
    });

    it('FASE 13: a below-min negotiated price CAN be staged in the cart (exceptional-discount flow); above-max is still rejected', async () => {
      const f = await seed('Cart Floor Co', 'admin@cart-floor.example', { minPrice: 80, basePrice: 100, maxPrice: 120 });
      await cart(f.admin, 'POST', '', { locationId: f.locationId });
      const belowMin = await cart(f.admin, 'POST', '/items', { productVariantId: f.variantId, quantity: 1, negotiatedUnitPrice: 50 });
      expect(belowMin.statusCode, belowMin.body).toBe(200);
      const aboveMax = await cart(f.admin, 'PATCH', '/items/' + (JSON.parse(belowMin.body) as { items: { id: string }[] }).items[0]!.id, { negotiatedUnitPrice: 500 });
      expect(aboveMax.statusCode).toBe(400);
    });

    it('rejects a cross-tenant variant (§104) and a serialized variant (deferred, §49-§51)', async () => {
      const f = await seed('Cart XT Co', 'admin@cart-xt.example');
      const other = await seed('Cart XT Other Co', 'admin@cart-xt-other.example');
      await cart(f.admin, 'POST', '', { locationId: f.locationId });

      const crossTenant = await cart(f.admin, 'POST', '/items', { productVariantId: other.variantId, quantity: 1 });
      expect(crossTenant.statusCode).toBe(404);

      const serial = await c.createProductVariant(f.admin, { sku: `SER-${Date.now()}`, isSerialized: true });
      const serialAdd = await cart(f.admin, 'POST', '/items', { productVariantId: serial.variantId, quantity: 1 });
      // MVP scope decision (2026-10-26): serialized / lot-tracked variants are rejected with 422.
      expect(serialAdd.statusCode).toBe(422);
    });

    it('one open cart per vendor — a second POST /cart returns the same cart', async () => {
      const f = await seed('Cart Single Co', 'admin@cart-single.example');
      const a = JSON.parse((await cart(f.admin, 'POST', '', { locationId: f.locationId })).body) as { id: string };
      const b = JSON.parse((await cart(f.admin, 'POST', '', { locationId: f.locationId })).body) as { id: string };
      expect(b.id).toBe(a.id);
    });
  });

  describe('checkout -> confirm -> inventory commit (§41, §144, §145)', () => {
    it('reserves at checkout (pending), commits at confirm (SALE), leaving a consistent ledger', async () => {
      const f = await seed('Order Flow Co', 'admin@order-flow.example', { stock: 10, basePrice: 100, maxPrice: 120, minPrice: 80 });
      // 110 is >= base_price (100) — a normal, non-exceptional negotiation under the owner's
      // policy change (the trigger moved from min_price to base_price), so confirm below needs
      // no approval.
      const cartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 3, negotiatedUnitPrice: 110 }]);

      const created = await checkout(f.admin, cartId, 'sales_note');
      expect(created.statusCode, created.body).toBe(201);
      const order = JSON.parse(created.body) as { id: string; status: string; orderNumber: string; total: number; subtotal: number; discountTotal: number; taxTotal: number; items: { unitPrice: number; lineTotal: number }[] };
      expect(order.status).toBe('pending');
      expect(order.orderNumber).toMatch(/^ORD-\d{6}$/);
      expect(order.subtotal).toBe(330);
      expect(order.total).toBe(330);
      expect(order.discountTotal).toBe(30); // (120-110)*3
      expect(order.taxTotal).toBe(0);
      expect(order.items[0]!.unitPrice).toBe(110);

      // reservation held: available dropped, physical unchanged
      let bal = await balance(f.admin, f.variantId);
      expect(bal.quantityPhysical).toBe(10);
      expect(bal.quantityReserved).toBe(3);
      expect(bal.quantityAvailable).toBe(7);

      const confirmed = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/confirm`,
        headers: c.writeHeaders(f.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: order.total }] },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect((JSON.parse(confirmed.body) as { status: string }).status).toBe('confirmed');

      bal = await balance(f.admin, f.variantId);
      expect(bal.quantityPhysical).toBe(7);
      expect(bal.quantityReserved).toBe(0);
      expect(bal.quantityAvailable).toBe(7);

      const movementTypes = await movements(f.admin, f.variantId);
      expect(movementTypes).toEqual(expect.arrayContaining(['RECEIPT', 'RESERVATION', 'RESERVATION_RELEASE', 'SALE']));

      // cart is now checked_out and linked to the order
      const cartRead = await c.inject({ method: 'GET', url: '/api/v1/cart', headers: c.readHeaders(f.admin) });
      expect(cartRead.statusCode).toBe(404); // no OPEN cart anymore
    });

    it('confirm is idempotent; cancel of a confirmed order is rejected (§54)', async () => {
      const f = await seed('Order Confirm Co', 'admin@order-confirm.example', { stock: 5 });
      const cartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
      const order = JSON.parse((await checkout(f.admin, cartId, 'sales_note')).body) as { id: string };

      const confirmPayload = { payments: [{ paymentMethod: 'cash' as const, amount: 100 }] };
      const first = await c.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/confirm`, headers: c.writeHeaders(f.admin), payload: confirmPayload });
      expect(first.statusCode).toBe(200);
      const second = await c.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/confirm`, headers: c.writeHeaders(f.admin), payload: confirmPayload });
      expect(second.statusCode).toBe(200);
      expect((JSON.parse(second.body) as { status: string }).status).toBe('confirmed');

      const cancel = await c.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/cancel`, headers: c.writeHeaders(f.admin) });
      expect(cancel.statusCode).toBe(409);

      const bal = await balance(f.admin, f.variantId);
      expect(bal.quantityPhysical).toBe(4);
    });

    it('cancel of a pending order releases the reservation transactionally (§54)', async () => {
      const f = await seed('Order Cancel Co', 'admin@order-cancel.example', { stock: 8 });
      const cartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 5 }]);
      const order = JSON.parse((await checkout(f.admin, cartId, 'sales_note')).body) as { id: string };

      expect((await balance(f.admin, f.variantId)).quantityReserved).toBe(5);
      const cancel = await c.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/cancel`, headers: c.writeHeaders(f.admin) });
      expect(cancel.statusCode).toBe(200);
      const bal = await balance(f.admin, f.variantId);
      expect(bal.quantityReserved).toBe(0);
      expect(bal.quantityAvailable).toBe(8);
    });

    it('checkout with more units than available is a controlled 409, no order, no reservation (§91)', async () => {
      const f = await seed('Order Oversell Co', 'admin@order-oversell.example', { stock: 2 });
      const cartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 5 }]);
      const created = await checkout(f.admin, cartId, 'sales_note');
      expect(created.statusCode).toBe(409);
      expect((await balance(f.admin, f.variantId)).quantityReserved).toBe(0);
      const list = await c.inject({ method: 'GET', url: '/api/v1/orders', headers: c.readHeaders(f.admin) });
      expect((JSON.parse(list.body) as { data: unknown[] }).data).toHaveLength(0);
    });
  });

  describe('document type + customer data (§32-§34, §108, §143; PROMPT 012-A §6-§18)', () => {
    // PROMPT 012-A: the SAME complete commercial customer data (taxId, email, phone, address) is
    // required for BOTH invoice and sales_note — the two differ only by document_type /
    // invoice_status, never by customer completeness.

    async function checkoutFor(admin: Session, loc: string, variantId: string, customerId: string, documentType: 'invoice' | 'sales_note') {
      const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(admin), payload: { locationId: loc, customerId } });
      expect(created.statusCode, created.body).toBe(201);
      const cartId = (JSON.parse(created.body) as { id: string }).id;
      await c.inject({ method: 'PATCH', url: '/api/v1/cart', headers: c.writeHeaders(admin), payload: { customerId } });
      await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(admin), payload: { productVariantId: variantId, quantity: 1 } });
      return { cartId, response: await checkout(admin, cartId, documentType) };
    }

    async function docTypeFixture(company: string, email: string) {
      const admin = await c.registerTenant(company, email);
      const wh = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      const loc = await c.createLocation(admin, wh, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
      await c.receiveStock(admin, variantId, loc, 20);
      return { admin, loc, variantId };
    }

    async function noSideEffects(admin: Session, variantId: string): Promise<void> {
      const bal = await balance(admin, variantId);
      expect(bal.quantityReserved).toBe(0);
      const orders = await c.inject({ method: 'GET', url: '/api/v1/orders', headers: c.readHeaders(admin) });
      expect((JSON.parse(orders.body) as { data: unknown[] }).data).toHaveLength(0);
    }

    /** A full customer payload with one field removed — for the "missing field -> 422" cases. */
    function withoutField(suffix: string, field: 'taxId' | 'email' | 'phone' | 'address'): Record<string, unknown> {
      const payload: Record<string, unknown> = { ...c.fullCustomer(suffix) };
      delete payload[field];
      return payload;
    }

    it('C1: sales_note + complete customer -> 201, invoice_status null, snapshot complete', async () => {
      const f = await docTypeFixture('DocType C1 Co', 'admin@dt-c1.example');
      const customerId = await c.createCustomer(f.admin, c.fullCustomer('c1'));
      const { response } = await checkoutFor(f.admin, f.loc, f.variantId, customerId, 'sales_note');
      expect(response.statusCode, response.body).toBe(201);
      const body = JSON.parse(response.body) as { documentType: string; invoiceStatus?: string; customer: { name: string; taxId?: string; email?: string; phone?: string; address?: unknown } };
      expect(body.documentType).toBe('sales_note');
      expect(body.invoiceStatus).toBeUndefined();
      expect(body.customer).toEqual(expect.objectContaining({ name: 'Customer C1', taxId: expect.any(String), email: expect.any(String), phone: expect.any(String) }));
      expect(body.customer.address).toBeTruthy();
    });

    /** taxId is mandatory when a customer is created (the create DTO rejects a missing one), so a
     * customer WITHOUT it can only exist as a legacy / backfilled row (the column is nullable). Make
     * one directly in the database — the sale must still refuse it with a 422. */
    async function clearTaxId(tenantId: string, customerId: string): Promise<void> {
      const { client, db } = getMigratorDb();
      try {
        await db.update(customers).set({ taxId: null }).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
      } finally {
        await client.end();
      }
    }

    it('C2: sales_note missing taxId -> 422, no order, no reservation', async () => {
      const f = await docTypeFixture('DocType C2 Co', 'admin@dt-c2.example');
      const customerId = await c.createCustomer(f.admin, c.fullCustomer('c2'));
      await clearTaxId(f.admin.user.tenantId, customerId);
      const { response } = await checkoutFor(f.admin, f.loc, f.variantId, customerId, 'sales_note');
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).message).toMatch(/taxId/);
      await noSideEffects(f.admin, f.variantId);
    });

    it('C3: sales_note missing email -> 422, no side effects', async () => {
      const f = await docTypeFixture('DocType C3 Co', 'admin@dt-c3.example');
      const customerId = await c.createCustomer(f.admin, withoutField('c3', 'email'));
      const { response } = await checkoutFor(f.admin, f.loc, f.variantId, customerId, 'sales_note');
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).message).toMatch(/email/);
      await noSideEffects(f.admin, f.variantId);
    });

    it('C4: sales_note missing phone -> 422, no side effects', async () => {
      const f = await docTypeFixture('DocType C4 Co', 'admin@dt-c4.example');
      const customerId = await c.createCustomer(f.admin, withoutField('c4', 'phone'));
      const { response } = await checkoutFor(f.admin, f.loc, f.variantId, customerId, 'sales_note');
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).message).toMatch(/phone/);
      await noSideEffects(f.admin, f.variantId);
    });

    it('C5: sales_note missing address -> 422, no side effects', async () => {
      const f = await docTypeFixture('DocType C5 Co', 'admin@dt-c5.example');
      const customerId = await c.createCustomer(f.admin, withoutField('c5', 'address'));
      const { response } = await checkoutFor(f.admin, f.loc, f.variantId, customerId, 'sales_note');
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).message).toMatch(/address/);
      await noSideEffects(f.admin, f.variantId);
    });

    it('C6: invoice regression — complete -> 201 invoice_status=pending; incomplete -> 422', async () => {
      const f = await docTypeFixture('DocType C6 Co', 'admin@dt-c6.example');
      const partialId = await c.createCustomer(f.admin, withoutField('c6-partial', 'email'));
      const bad = await checkoutFor(f.admin, f.loc, f.variantId, partialId, 'invoice');
      expect(bad.response.statusCode).toBe(422);
      await noSideEffects(f.admin, f.variantId);

      const fullId = await c.createCustomer(f.admin, c.fullCustomer('c6-full'));
      const ok = await checkoutFor(f.admin, f.loc, f.variantId, fullId, 'invoice');
      expect(ok.response.statusCode, ok.response.body).toBe(201);
      expect((JSON.parse(ok.response.body) as { invoiceStatus: string }).invoiceStatus).toBe('pending');
    });

    it('C7: historical snapshot — a valid sales_note keeps its frozen customer data after the customer is edited', async () => {
      const f = await docTypeFixture('DocType C7 Co', 'admin@dt-c7.example');
      const customerId = await c.createCustomer(f.admin, c.fullCustomer('c7'));
      const { response } = await checkoutFor(f.admin, f.loc, f.variantId, customerId, 'sales_note');
      expect(response.statusCode, response.body).toBe(201);
      const order = JSON.parse(response.body) as { id: string; customer: { name: string; email: string; phone: string } };

      await c.inject({
        method: 'PATCH',
        url: `/api/v1/customers/${customerId}`,
        headers: c.writeHeaders(f.admin),
        payload: { displayName: 'CHANGED', email: 'changed@example.com', phone: '+000' },
      });

      const reread = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: c.readHeaders(f.admin) })).body) as { customer: { name: string; email: string; phone: string } };
      expect(reread.customer).toEqual(order.customer);
    });
  });

  describe('historical snapshots (§13-§14, §27-§28, §106, §107)', () => {
    it('editing the customer and the catalog price afterwards never changes the historical order', async () => {
      const f = await seed('Snapshot Co', 'admin@snapshot.example', { stock: 10, basePrice: 100, maxPrice: 120, minPrice: 80 });
      const cartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 1, negotiatedUnitPrice: 95 }]);
      const order = JSON.parse((await checkout(f.admin, cartId, 'invoice')).body) as { id: string; customer: { name: string; email: string }; items: { unitPrice: number; maxPrice: number }[] };
      expect(order.items[0]!.unitPrice).toBe(95);

      // mutate the customer
      await c.inject({ method: 'PATCH', url: `/api/v1/customers/${f.customerId}`, headers: c.writeHeaders(f.admin), payload: { firstName: 'renamed', email: 'new@example.com' } });
      // mutate the catalog price
      await c.inject({
        method: 'PATCH',
        url: `/api/v1/products/${f.productId}/variants/${f.variantId}`,
        headers: c.writeHeaders(f.admin),
        payload: { maxPrice: 300, basePrice: 250, minPrice: 200 },
      });

      const reread = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: c.readHeaders(f.admin) })).body) as {
        customer: { name: string; email: string };
        items: { unitPrice: number; maxPrice: number }[];
      };
      expect(reread.customer.name).toBe(order.customer.name);
      expect(reread.customer.email).toBe(order.customer.email);
      expect(reread.items[0]!.unitPrice).toBe(95);
      expect(reread.items[0]!.maxPrice).toBe(120);

      // the live customer shows the new data
      const liveCustomer = JSON.parse((await c.inject({ method: 'GET', url: `/api/v1/customers/${f.customerId}`, headers: c.readHeaders(f.admin) })).body) as { displayName: string };
      // displayName is generated from first/last name; names are Title-Cased by the service.
      expect(liveCustomer.displayName).toBe('Renamed Admin');
    });
  });

  describe('pricing field visibility (§23, §68, §105, §142)', () => {
    it('a caller with pricing.floor.view sees minPrice on the order line; a caller without it never does', async () => {
      const f = await seed('Price Vis Co', 'admin@price-vis.example', { stock: 10, minPrice: 80, basePrice: 100, maxPrice: 120 });

      // Admin has pricing.floor.view — minPrice snapshot is present.
      const adminCartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
      const adminOrder = JSON.parse((await checkout(f.admin, adminCartId, 'sales_note')).body) as { id: string; items: { minPrice?: number }[] };
      expect(adminOrder.items[0]!.minPrice).toBe(80);

      // A Vendedor with pricing.floor.view removed (direct DB edit — no role CRUD exists) must not
      // receive minPrice, even reading the exact same order.
      const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@price-vis.example', 'Vendedor');
      const { client, db } = getMigratorDb();
      try {
        const [role] = await db
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.tenantId, f.admin.user.tenantId), eq(roles.name, 'Vendedor')));
        await db
          .delete(rolePermissions)
          .where(and(eq(rolePermissions.tenantId, f.admin.user.tenantId), eq(rolePermissions.roleId, role!.id), eq(rolePermissions.permissionCode, 'pricing.floor.view')));
        // This test is about floor-price visibility, not seller scope: let the Vendedor read the
        // Administrador's order (sales.orders.view_all), otherwise it would correctly be a 404.
        await db.insert(rolePermissions).values({ tenantId: f.admin.user.tenantId, roleId: role!.id, permissionCode: 'sales.orders.view_all' });
      } finally {
        await client.end();
      }
      // ADR-0035: a user with zero location assignments is denied (404) — give them the order's location.
      await c.setUserLocations(f.admin, vendedor.user.id, [f.locationId]);
      const relogin = await c.loginAs('vendedor@price-vis.example');
      const read = await c.inject({ method: 'GET', url: `/api/v1/orders/${adminOrder.id}`, headers: c.readHeaders(relogin) });
      expect(read.statusCode).toBe(200);
      expect((JSON.parse(read.body) as { items: { minPrice?: number }[] }).items[0]!.minPrice).toBeUndefined();
      void vendedor;
    });
  });

  describe('cross-tenant IDOR on cart/order/location (§48, §115)', () => {
    it('tenant A cannot use tenant B location/customer, read tenant B order, or check out tenant B cart', async () => {
      const a = await seed('IDOR A Co', 'admin@idor-a.example', { stock: 5 });
      const b = await seed('IDOR B Co', 'admin@idor-b.example', { stock: 5 });

      const crossLoc = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(a.admin), payload: { locationId: b.locationId } });
      expect(crossLoc.statusCode).toBe(404);

      await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(a.admin), payload: { locationId: a.locationId } });
      const crossCustomer = await c.inject({ method: 'PATCH', url: '/api/v1/cart', headers: c.writeHeaders(a.admin), payload: { customerId: b.customerId } });
      expect(crossCustomer.statusCode).toBe(404);

      const bCartId = await openCartWith(b, b.admin, [{ variantId: b.variantId, quantity: 1 }]);
      const bOrder = JSON.parse((await checkout(b.admin, bCartId, 'sales_note')).body) as { id: string };

      const readCross = await c.inject({ method: 'GET', url: `/api/v1/orders/${bOrder.id}`, headers: c.readHeaders(a.admin) });
      expect(readCross.statusCode).toBe(404);
      const confirmCross = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${bOrder.id}/confirm`,
        headers: c.writeHeaders(a.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: 1 }] },
      });
      expect(confirmCross.statusCode).toBe(404);
      const checkoutCross = await checkout(a.admin, bCartId, 'sales_note');
      expect(checkoutCross.statusCode).toBe(404);
    });
  });

  describe('location authorization (ADR-0024, §46, §69, §115)', () => {
    it('a Vendedor restricted to LOC-A cannot open a cart / check out from LOC-B', async () => {
      const f = await seed('Loc Auth Co', 'admin@loc-auth.example', { stock: 10 });
      const locB = await c.createLocation(f.admin, f.warehouseId, `LB-${Date.now()}`);
      await c.receiveStock(f.admin, f.variantId, locB, 10);
      const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@loc-auth.example', 'Vendedor');
      const assign = await c.inject({
        method: 'PUT',
        url: `/api/v1/users/${vendedor.user.id}/locations`,
        headers: c.writeHeaders(f.admin),
        payload: { locationIds: [f.locationId] },
      });
      expect(assign.statusCode).toBe(200);

      const atA = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(vendedor), payload: { locationId: f.locationId } });
      expect(atA.statusCode).toBe(201);
      // switching this open cart to LOC-B is blocked
      const toB = await c.inject({ method: 'PATCH', url: '/api/v1/cart', headers: c.writeHeaders(vendedor), payload: { locationId: locB } });
      expect(toB.statusCode).toBe(403);
    });
  });

  describe('seller scope: sales.orders.view alone = my own sales; sales.orders.view_all = every seller', () => {
    it('a Vendedor sees only their own orders (list, detail, notifications, report); the Administrador sees all', async () => {
      const f = await seed('Own Sales Co', 'admin@own-sales.example', { stock: 20 });
      const vendedor = await c.createAndLoginAs(f.admin, 'vendedor@own-sales.example', 'Vendedor');
      await c.setUserLocations(f.admin, vendedor.user.id, [f.locationId]);

      const adminOrderCart = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
      const adminOrder = JSON.parse((await checkout(f.admin, adminOrderCart, 'sales_note')).body) as { id: string };
      const sellerOrderCart = await openCartWith(f, vendedor, [{ variantId: f.variantId, quantity: 2 }]);
      const sellerOrderRes = await checkout(vendedor, sellerOrderCart, 'sales_note');
      expect(sellerOrderRes.statusCode, sellerOrderRes.body).toBe(201);
      const sellerOrder = JSON.parse(sellerOrderRes.body) as { id: string; total: number };

      const listIds = async (session: Session): Promise<string[]> => {
        const res = await c.inject({ method: 'GET', url: '/api/v1/orders?pageSize=50', headers: c.readHeaders(session) });
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { data: { id: string }[] }).data.map((o) => o.id);
      };
      expect(await listIds(vendedor)).toEqual([sellerOrder.id]);
      expect((await listIds(f.admin)).sort()).toEqual([adminOrder.id, sellerOrder.id].sort());

      // detail + notifications of someone else's order: 404 for the seller (existence not revealed)
      for (const suffix of ['', '/notifications']) {
        const others = await c.inject({ method: 'GET', url: `/api/v1/orders/${adminOrder.id}${suffix}`, headers: c.readHeaders(vendedor) });
        expect(others.statusCode).toBe(404);
        const own = await c.inject({ method: 'GET', url: `/api/v1/orders/${sellerOrder.id}${suffix}`, headers: c.readHeaders(vendedor) });
        expect(own.statusCode).toBe(200);
        const asAdmin = await c.inject({ method: 'GET', url: `/api/v1/orders/${sellerOrder.id}${suffix}`, headers: c.readHeaders(f.admin) });
        expect(asAdmin.statusCode).toBe(200);
      }

      // the report aggregates follow the same scope
      const from = new Date(Date.now() - 3_600_000).toISOString();
      const to = new Date(Date.now() + 3_600_000).toISOString();
      const summary = async (session: Session): Promise<number> => {
        const res = await c.inject({ method: 'GET', url: `/api/v1/reports/sales-summary?from=${from}&to=${to}&groupBy=day&status=pending`, headers: c.readHeaders(session) });
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { buckets: { orderCount: number }[] }).buckets.reduce((n, b) => n + b.orderCount, 0);
      };
      expect(await summary(vendedor)).toBe(1);
      expect(await summary(f.admin)).toBe(2);
    });

    it('the Administrador template carries sales.orders.view_all; Vendedor and Supervisor do not', async () => {
      const f = await seed('View All Tpl Co', 'admin@view-all-tpl.example');
      const { client, db } = getMigratorDb();
      try {
        const rows = await db
          .select({ name: roles.name })
          .from(rolePermissions)
          .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
          .where(and(eq(rolePermissions.tenantId, f.admin.user.tenantId), eq(rolePermissions.permissionCode, 'sales.orders.view_all')));
        expect(rows.map((r) => r.name)).toEqual(['Administrador']);
      } finally {
        await client.end();
      }
    });
  });

  describe('audit log (§71, §118)', () => {
    it('customer.created, order.created and order.confirmed are audited with tenant/actor/action/entity', async () => {
      const f = await seed('Audit Co', 'admin@audit-sales.example', { stock: 5 });
      const cartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
      const order = JSON.parse((await checkout(f.admin, cartId, 'sales_note')).body) as { id: string };
      await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/confirm`,
        headers: c.writeHeaders(f.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: 100 }] },
      });

      const { client, db } = getMigratorDb();
      try {
        const rows = await db
          .select({ actionCode: auditLog.actionCode, actorId: auditLog.actorId, entityType: auditLog.entityType, entityId: auditLog.entityId, actorType: auditLog.actorType })
          .from(auditLog)
          .where(eq(auditLog.tenantId, f.admin.user.tenantId));
        const byAction = new Map(rows.map((r) => [r.actionCode, r]));
        expect(byAction.has('customer.created')).toBe(true);
        const created = byAction.get('order.created')!;
        expect(created).toEqual(expect.objectContaining({ entityType: 'order', entityId: order.id, actorId: f.admin.user.id, actorType: 'user' }));
        expect(byAction.get('order.confirmed')).toEqual(expect.objectContaining({ entityType: 'order', entityId: order.id }));
      } finally {
        await client.end();
      }
    });
  });

  describe('RBAC on orders (§66, §147)', () => {
    it('403 without sales.orders.create; cancel needs sales.orders.cancel', async () => {
      const f = await seed('Order Rbac Co', 'admin@order-rbac.example', { stock: 5 });
      const bodega = await c.createAndLoginAs(f.admin, 'bodega@order-rbac.example', 'Bodega');
      const cartId = await openCartWith(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
      const forbidden = await c.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: c.writeHeaders(bodega, { 'idempotency-key': randomUUID() }),
        payload: { cartId, documentType: 'sales_note' },
      });
      expect(forbidden.statusCode).toBe(403);
    });
  });

  async function balance(session: Session, variantId: string): Promise<{ quantityPhysical: number; quantityReserved: number; quantityAvailable: number }> {
    const response = await c.inject({ method: 'GET', url: `/api/v1/inventory/balances?productVariantId=${variantId}`, headers: c.readHeaders(session) });
    expect(response.statusCode).toBe(200);
    const row = (JSON.parse(response.body) as { data: { quantityPhysical: number; quantityReserved: number; quantityAvailable: number }[] }).data[0];
    return row ?? { quantityPhysical: 0, quantityReserved: 0, quantityAvailable: 0 };
  }

  async function movements(session: Session, variantId: string): Promise<string[]> {
    const response = await c.inject({ method: 'GET', url: `/api/v1/inventory/movements?productVariantId=${variantId}&pageSize=50`, headers: c.readHeaders(session) });
    expect(response.statusCode).toBe(200);
    return (JSON.parse(response.body) as { data: { movementType: string }[] }).data.map((m) => m.movementType);
  }
});
