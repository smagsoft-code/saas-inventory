import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rolePermissions, roles } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * F18-04 — `GET /api/v1/reports/returns-summary` end to end against real PostgreSQL, through the
 * real `buildApp()` (no mocks): tenant isolation, RBAC, `[from, to)` boundary semantics, the
 * `status='resolved'` default, real SUM/COUNT aggregation (never a client-side fold), multi-line /
 * multi-disposition cardinality, and day/week/month/product/customer/disposition grouping. Every
 * fixture return goes through the real create -> inspect -> resolve lifecycle
 * (`sales-returns.integration.test.ts`'s own helper shapes) — no direct SQL insert into
 * `sales_returns`/`sales_return_items`, so every fixture is exactly as valid as a real return.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: returns summary (integration, F18-04)', () => {
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
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string, unitPrice = 100): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const sellLocationId = await c.createLocation(admin, warehouseId, `SELL-${uniq()}`, { isSellable: true });
    const quarantineLocationId = await c.createLocation(admin, warehouseId, `QUAR-${uniq()}`, { isSellable: false });
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: unitPrice, basePrice: unitPrice, minPrice: unitPrice });
    await c.receiveStock(admin, variantId, sellLocationId, 1000);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, tenantId, warehouseId, sellLocationId, quarantineLocationId, variantId, customerId };
  }

  async function addAnotherVariant(f: Fixture, unitPrice: number): Promise<string> {
    const { variantId } = await c.createProductVariant(f.admin, { sku: `SKU-${uniq()}`, maxPrice: unitPrice, basePrice: unitPrice, minPrice: unitPrice });
    await c.receiveStock(f.admin, variantId, f.sellLocationId, 1000);
    return variantId;
  }

  /** A confirmed order for `quantity` units of the given variant, sold from `sellLocationId`. */
  async function confirmedOrder(
    f: Pick<Fixture, 'admin' | 'sellLocationId' | 'customerId'>,
    variantId: string,
    quantity: number,
    unitPrice = 100,
  ): Promise<{ orderId: string; orderItemId: string }> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.sellLocationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: variantId, quantity } });
    expect(added.statusCode, added.body).toBe(200);
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    const body = JSON.parse(order.body) as { id: string; items: { id: string }[] };
    const confirmed = await c.inject({
      method: 'POST',
      url: `/api/v1/orders/${body.id}/confirm`,
      headers: c.writeHeaders(f.admin),
      payload: { payments: [{ paymentMethod: 'cash', amount: quantity * unitPrice }] },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return { orderId: body.id, orderItemId: body.items[0]!.id };
  }

  const createReturn = (session: Session, payload: Record<string, unknown>, key = randomUUID()) =>
    c.inject({ method: 'POST', url: '/api/v1/sales-returns', headers: c.writeHeaders(session, { 'idempotency-key': key }), payload });

  const inspectReturn = (session: Session, id: string, payload: Record<string, unknown>) =>
    c.inject({ method: 'POST', url: `/api/v1/sales-returns/${id}/inspect`, headers: c.writeHeaders(session), payload });

  const resolveReturn = (session: Session, id: string, key = randomUUID()) =>
    c.inject({ method: 'POST', url: `/api/v1/sales-returns/${id}/resolve`, headers: c.writeHeaders(session, { 'idempotency-key': key }) });

  interface ReturnBody {
    id: string;
    orderId: string;
    status: string;
    createdAt: string;
    items: { id: string; orderItemId: string; quantityReturned: number }[];
  }

  /** Full create -> inspect -> resolve lifecycle for one order-item line, one disposition. Returns
   * the return's own `createdAt` (the report's bucket key — `sales_returns` has no `resolved_at`,
   * `GAP-RETURN-RESOLVED-AT`). */
  async function resolvedReturn(
    f: Pick<Fixture, 'admin' | 'sellLocationId' | 'quarantineLocationId'>,
    orderId: string,
    lines: { orderItemId: string; quantity: number; disposition: 'restock' | 'quarantine' | 'damaged' | 'scrap' }[],
  ): Promise<ReturnBody> {
    const created = await createReturn(f.admin, {
      orderId,
      locationId: f.sellLocationId,
      reason: 'integration test',
      items: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })),
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = JSON.parse(created.body) as ReturnBody;
    const inspected = await inspectReturn(f.admin, body.id, {
      items: body.items.map((item, i) => ({
        returnItemId: item.id,
        disposition: lines[i]!.disposition,
        dispositionLocationId: lines[i]!.disposition === 'restock' ? f.sellLocationId : f.quarantineLocationId,
      })),
    });
    expect(inspected.statusCode, inspected.body).toBe(200);
    const resolved = await resolveReturn(f.admin, body.id);
    expect(resolved.statusCode, resolved.body).toBe(200);
    return JSON.parse(resolved.body) as ReturnBody;
  }

  function summary(session: Session, query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return c.inject({ method: 'GET', url: `/api/v1/reports/returns-summary?${params}`, headers: c.readHeaders(session) });
  }

  /** Strips one permission from one tenant's copy of a default-role-template — every default role
   * (Administrador/Supervisor/Vendedor/Bodega) carries `sales.returns.view`, so a real
   * "authenticated without this permission" case cannot be reached through any default role.
   * Removing a single `role_permissions` row for a role created inside this test's own throwaway
   * tenant (the disposable `pg-verify` database, never a persistent one) is the minimal way to
   * exercise the 403 path honestly, without inventing a role-CRUD endpoint that doesn't exist
   * (`GAP-ROLE-CRUD`). Permissions are re-read live per request (`TenantGuard` /
   * `loadEffectivePermissions`, PROMPT 011-B) — no re-login needed for this to take effect. */
  async function stripPermission(tenantId: string, roleName: string, permissionCode: string): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      const [role] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.name, roleName)));
      if (!role) throw new Error(`Role "${roleName}" not found for tenant ${tenantId}`);
      await db.delete(rolePermissions).where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionCode, permissionCode)));
    } finally {
      await client.end();
    }
  }

  const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  interface PeriodBucket {
    key: string;
    returnCount: number;
    orderCount: number;
    lineCount: number;
    quantity: number;
    returnedValue: number;
    avgReturnValue: number;
  }
  interface ProductBucket { key: string; sku: string; productName: string; returnCount: number; orderCount: number; lineCount: number; quantity: number; returnedValue: number }
  interface CustomerBucket { key: string; customerName: string; returnCount: number; orderCount: number; lineCount: number; quantity: number; returnedValue: number; avgReturnValue: number }
  interface DispositionBucket { key: string; lineCount: number; quantity: number; returnedValue: number }
  interface SummaryBody {
    from: string;
    to: string;
    timezone: string;
    currency: string;
    groupBy: string;
    buckets: (PeriodBucket | ProductBucket | CustomerBucket | DispositionBucket)[];
  }

  describe('access control', () => {
    it('an unauthenticated caller is 401', async () => {
      const res = await c.inject({ method: 'GET', url: '/api/v1/reports/returns-summary?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z' });
      expect(res.statusCode).toBe(401);
    });

    it('requires sales.returns.view — a role stripped of it is 403', async () => {
      const f = await seed('Returns Access Co', `admin@returns-access-${uniq()}.example`);
      const vendedor = await c.createAndLoginAs(f.admin, `vendedor-${uniq()}@ex.example`, 'Vendedor');
      await stripPermission(f.tenantId, 'Vendedor', 'sales.returns.view');
      const res = await summary(vendedor, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(res.statusCode).toBe(403);
    });

    it('an Administrador user (sales.returns.view granted by default) gets 200', async () => {
      const f = await seed('Returns Access OK Co', `admin@returns-access-ok-${uniq()}.example`);
      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  describe('query validation', () => {
    it('400 when `from` is missing', async () => {
      const f = await seed('Returns QV1 Co', `admin@returns-qv1-${uniq()}.example`);
      const res = await summary(f.admin, { to: IN_AN_HOUR });
      expect(res.statusCode).toBe(400);
    });

    it('400 when `to` is missing', async () => {
      const f = await seed('Returns QV2 Co', `admin@returns-qv2-${uniq()}.example`);
      const res = await summary(f.admin, { from: HOUR_AGO });
      expect(res.statusCode).toBe(400);
    });

    it('400 when `from` is not strictly before `to`', async () => {
      const f = await seed('Returns QV3 Co', `admin@returns-qv3-${uniq()}.example`);
      const res = await summary(f.admin, { from: IN_AN_HOUR, to: HOUR_AGO });
      expect(res.statusCode).toBe(400);
    });

    it('400 on an invalid groupBy value — never silently ignored', async () => {
      const f = await seed('Returns QV4 Co', `admin@returns-qv4-${uniq()}.example`);
      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'location' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('empty state', () => {
    it('a brand-new tenant with zero returns gets 200 and an empty buckets array', async () => {
      const f = await seed('Returns Empty Co', `admin@returns-empty-${uniq()}.example`);
      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.buckets).toEqual([]);
      expect(body.groupBy).toBe('day');
      expect(body.currency).toBe('USD');
    });
  });

  describe('tenant isolation', () => {
    it("tenant A never sees tenant B's returns in the summary", async () => {
      const a = await seed('Returns Iso A', `admin@returns-iso-a-${uniq()}.example`);
      const b = await seed('Returns Iso B', `admin@returns-iso-b-${uniq()}.example`);
      const { orderId: orderA, orderItemId: itemA } = await confirmedOrder(a, a.variantId, 5);
      const { orderId: orderB, orderItemId: itemB } = await confirmedOrder(b, b.variantId, 5);
      await resolvedReturn(a, orderA, [{ orderItemId: itemA, quantity: 2, disposition: 'restock' }]);
      await resolvedReturn(b, orderB, [{ orderItemId: itemB, quantity: 3, disposition: 'restock' }]);

      const resA = await summary(a.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      const resB = await summary(b.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(resA.statusCode, resA.body).toBe(200);
      expect(resB.statusCode, resB.body).toBe(200);
      const bodyA = JSON.parse(resA.body) as SummaryBody;
      const bodyB = JSON.parse(resB.body) as SummaryBody;
      const totalA = (bodyA.buckets as PeriodBucket[]).reduce((n, x) => n + x.quantity, 0);
      const totalB = (bodyB.buckets as PeriodBucket[]).reduce((n, x) => n + x.quantity, 0);
      expect(totalA).toBe(2);
      expect(totalB).toBe(3);
    });
  });

  describe('[from, to) boundary semantics', () => {
    it('a return created exactly at `to` is excluded; the same instant as `from` is included', async () => {
      const f = await seed('Returns Boundary Co', `admin@returns-boundary-${uniq()}.example`);
      const { orderId, orderItemId } = await confirmedOrder(f, f.variantId, 5);
      const ret = await resolvedReturn(f, orderId, [{ orderItemId, quantity: 1, disposition: 'restock' }]);
      const at = ret.createdAt;
      const oneMsLater = new Date(new Date(at).getTime() + 1).toISOString();

      const excluded = await summary(f.admin, { from: HOUR_AGO, to: at });
      const excludedBody = JSON.parse(excluded.body) as SummaryBody;
      expect((excludedBody.buckets as PeriodBucket[]).reduce((n, x) => n + x.returnCount, 0)).toBe(0);

      const includedByTo = await summary(f.admin, { from: HOUR_AGO, to: oneMsLater });
      const includedByToBody = JSON.parse(includedByTo.body) as SummaryBody;
      expect((includedByToBody.buckets as PeriodBucket[]).reduce((n, x) => n + x.returnCount, 0)).toBe(1);

      const includedByFrom = await summary(f.admin, { from: at, to: IN_AN_HOUR });
      const includedByFromBody = JSON.parse(includedByFrom.body) as SummaryBody;
      expect((includedByFromBody.buckets as PeriodBucket[]).reduce((n, x) => n + x.returnCount, 0)).toBe(1);
    });
  });

  describe('status default and filtering', () => {
    it('defaults to status=resolved, excluding a still-requested return; status=requested flips it', async () => {
      const f = await seed('Returns Status Co', `admin@returns-status-${uniq()}.example`);
      const { orderId, orderItemId } = await confirmedOrder(f, f.variantId, 5);
      const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'stays requested', items: [{ orderItemId, quantity: 1 }] });
      expect(created.statusCode, created.body).toBe(201);

      const defaultRes = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      const defaultBody = JSON.parse(defaultRes.body) as SummaryBody;
      expect((defaultBody.buckets as PeriodBucket[]).reduce((n, x) => n + x.returnCount, 0)).toBe(0);

      const requestedRes = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, status: 'requested' });
      const requestedBody = JSON.parse(requestedRes.body) as SummaryBody;
      expect((requestedBody.buckets as PeriodBucket[]).reduce((n, x) => n + x.returnCount, 0)).toBe(1);
    });

    it('a cancelled return never counts toward the resolved default', async () => {
      const f = await seed('Returns Cancel Co', `admin@returns-cancel-${uniq()}.example`);
      const { orderId, orderItemId } = await confirmedOrder(f, f.variantId, 5);
      const created = await createReturn(f.admin, { orderId, locationId: f.sellLocationId, reason: 'will cancel', items: [{ orderItemId, quantity: 1 }] });
      const body = JSON.parse(created.body) as ReturnBody;
      const cancelled = await c.inject({ method: 'POST', url: `/api/v1/sales-returns/${body.id}/cancel`, headers: c.writeHeaders(f.admin) });
      expect(cancelled.statusCode, cancelled.body).toBe(200);

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, status: 'cancelled' });
      const resBody = JSON.parse(res.body) as SummaryBody;
      expect((resBody.buckets as PeriodBucket[]).reduce((n, x) => n + x.returnCount, 0)).toBe(1);

      const defaultRes = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      const defaultBody = JSON.parse(defaultRes.body) as SummaryBody;
      expect((defaultBody.buckets as PeriodBucket[]).reduce((n, x) => n + x.returnCount, 0)).toBe(0);
    });
  });

  describe('aggregation correctness', () => {
    it('returnCount/orderCount/lineCount/quantity/returnedValue/avgReturnValue match a known resolved return exactly', async () => {
      const f = await seed('Returns Agg Co', `admin@returns-agg-${uniq()}.example`, 100);
      const { orderId, orderItemId } = await confirmedOrder(f, f.variantId, 5);
      await resolvedReturn(f, orderId, [{ orderItemId, quantity: 3, disposition: 'restock' }]);

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.buckets).toHaveLength(1);
      const bucket = body.buckets[0] as PeriodBucket;
      expect(bucket.returnCount).toBe(1);
      expect(bucket.orderCount).toBe(1);
      expect(bucket.lineCount).toBe(1);
      expect(bucket.quantity).toBe(3);
      expect(bucket.returnedValue).toBe(300); // 3 * unit_price_snapshot (100)
      expect(bucket.avgReturnValue).toBe(300);
    });

    it('a multi-line return counts as ONE return, not one per line (no join fan-out inflation)', async () => {
      const f = await seed('Returns MultiLine Co', `admin@returns-multiline-${uniq()}.example`, 50);
      const variant2 = await addAnotherVariant(f, 50);
      const cart = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.sellLocationId, customerId: f.customerId } });
      const cartId = (JSON.parse(cart.body) as { id: string }).id;
      await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity: 4 } });
      await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: variant2, quantity: 4 } });
      const orderRes = await c.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
        payload: { cartId, documentType: 'sales_note' },
      });
      expect(orderRes.statusCode, orderRes.body).toBe(201);
      const order = JSON.parse(orderRes.body) as { id: string; items: { id: string; productVariantId: string }[] };
      const confirmed = await c.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/confirm`,
        headers: c.writeHeaders(f.admin),
        payload: { payments: [{ paymentMethod: 'cash', amount: 400 }] },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);

      const ret = await resolvedReturn(f, order.id, [
        { orderItemId: order.items[0]!.id, quantity: 2, disposition: 'restock' },
        { orderItemId: order.items[1]!.id, quantity: 2, disposition: 'restock' },
      ]);
      expect(ret.items).toHaveLength(2);

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
      const body = JSON.parse(res.body) as SummaryBody;
      const bucket = body.buckets[0] as PeriodBucket;
      expect(bucket.returnCount).toBe(1); // ONE return, not 2
      expect(bucket.orderCount).toBe(1);
      expect(bucket.lineCount).toBe(2);
      expect(bucket.quantity).toBe(4);
      expect(bucket.returnedValue).toBe(200); // (2*50) + (2*50)
    });
  });

  describe('groupBy=product', () => {
    it('groups by variant with frozen sku/productName, sums correctly across two products', async () => {
      const f = await seed('Returns Product Co', `admin@returns-product-${uniq()}.example`, 20);
      const variant2 = await addAnotherVariant(f, 40);
      const { orderId: order1, orderItemId: item1 } = await confirmedOrder(f, f.variantId, 10, 20);
      const { orderId: order2, orderItemId: item2 } = await confirmedOrder(f, variant2, 10, 40);
      await resolvedReturn(f, order1, [{ orderItemId: item1, quantity: 5, disposition: 'restock' }]);
      await resolvedReturn(f, order2, [{ orderItemId: item2, quantity: 2, disposition: 'damaged' }]);

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'product' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      const byKey = new Map((body.buckets as ProductBucket[]).map((b) => [b.key, b]));
      expect(byKey.get(f.variantId)!.quantity).toBe(5);
      expect(byKey.get(f.variantId)!.returnedValue).toBe(100); // 5 * 20
      expect(byKey.get(variant2)!.quantity).toBe(2);
      expect(byKey.get(variant2)!.returnedValue).toBe(80); // 2 * 40
      expect(byKey.get(f.variantId)!.sku).toBeTruthy();
      expect(byKey.get(f.variantId)!.productName).toBeTruthy();
    });
  });

  describe('groupBy=customer', () => {
    it('groups by customer with frozen customerName, sums correctly across two customers', async () => {
      const f = await seed('Returns Customer Co', `admin@returns-customer-${uniq()}.example`, 30);
      const customer2 = await c.createCustomer(f.admin, c.fullCustomer(`second-${uniq()}`));
      const { orderId: order1, orderItemId: item1 } = await confirmedOrder(f, f.variantId, 10, 30);
      const { orderId: order2, orderItemId: item2 } = await confirmedOrder({ admin: f.admin, sellLocationId: f.sellLocationId, customerId: customer2 }, f.variantId, 10, 30);
      await resolvedReturn(f, order1, [{ orderItemId: item1, quantity: 3, disposition: 'restock' }]);
      await resolvedReturn(f, order2, [{ orderItemId: item2, quantity: 4, disposition: 'restock' }]);

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'customer' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      const byKey = new Map((body.buckets as CustomerBucket[]).map((b) => [b.key, b]));
      expect(byKey.get(f.customerId)!.quantity).toBe(3);
      expect(byKey.get(customer2)!.quantity).toBe(4);
      expect(byKey.get(f.customerId)!.customerName).toBeTruthy();
    });
  });

  describe('groupBy=disposition', () => {
    it('groups by disposition; a line with no disposition (never inspected) is excluded, never invented into a bucket', async () => {
      const f = await seed('Returns Disposition Co', `admin@returns-disposition-${uniq()}.example`, 25);
      const { orderId, orderItemId } = await confirmedOrder(f, f.variantId, 20, 25);
      await resolvedReturn(f, orderId, [{ orderItemId, quantity: 3, disposition: 'restock' }]);

      const { orderId: order2, orderItemId: item2 } = await confirmedOrder(f, f.variantId, 20, 25);
      await resolvedReturn(f, order2, [{ orderItemId: item2, quantity: 2, disposition: 'damaged' }]);

      // A requested-but-not-yet-inspected return has disposition = NULL on its line.
      const { orderId: order3, orderItemId: item3 } = await confirmedOrder(f, f.variantId, 20, 25);
      await createReturn(f.admin, { orderId: order3, locationId: f.sellLocationId, reason: 'not inspected yet', items: [{ orderItemId: item3, quantity: 1 }] });

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'disposition', status: 'requested' });
      expect(res.statusCode, res.body).toBe(200);
      const requestedBody = JSON.parse(res.body) as SummaryBody;
      // The uninspected line's return is `requested`, but its disposition is NULL -> no bucket at all.
      expect(requestedBody.buckets).toEqual([]);

      const resolvedRes = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'disposition' });
      const body = JSON.parse(resolvedRes.body) as SummaryBody;
      const byKey = new Map((body.buckets as DispositionBucket[]).map((b) => [b.key, b]));
      expect(byKey.get('restock')!.quantity).toBe(3);
      expect(byKey.get('restock')!.returnedValue).toBe(75); // 3 * 25
      expect(byKey.get('damaged')!.quantity).toBe(2);
      expect(byKey.get('damaged')!.returnedValue).toBe(50); // 2 * 25
      expect(byKey.get('restock')).not.toHaveProperty('returnCount');
    });

    it('two returns with different dispositions contribute to both buckets without inflating quantity', async () => {
      const f = await seed('Returns MultiDisposition Co', `admin@returns-multidisposition-${uniq()}.example`, 10);
      const { orderId: order1, orderItemId: item1 } = await confirmedOrder(f, f.variantId, 10, 10);
      await resolvedReturn(f, order1, [{ orderItemId: item1, quantity: 6, disposition: 'restock' }]);

      // A second order/return so we get a second, distinct disposition without violating the
      // "one disposition per line" schema simplification (ADR-0021).
      const { orderId: order2, orderItemId: item2 } = await confirmedOrder(f, f.variantId, 10, 10);
      await resolvedReturn(f, order2, [{ orderItemId: item2, quantity: 4, disposition: 'scrap' }]);

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'disposition' });
      const body = JSON.parse(res.body) as SummaryBody;
      const byKey = new Map((body.buckets as DispositionBucket[]).map((b) => [b.key, b]));
      expect(byKey.get('restock')!.quantity).toBe(6);
      expect(byKey.get('scrap')!.quantity).toBe(4);
      // Total quantity across both buckets equals the real total (10) — no double-counting.
      const totalQuantity = (body.buckets as DispositionBucket[]).reduce((n, b) => n + b.quantity, 0);
      expect(totalQuantity).toBe(10);
    });
  });
});
