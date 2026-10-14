import { randomUUID } from 'node:crypto';
import { generateId } from '@saas-inventory/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceApprovals, tenantPricePolicies } from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getMigratorDb } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * F18-06 — the `exceptional` filter on `GET /api/v1/reports/sales-summary` (`GAP-EXCEPTIONAL-FILTER`).
 * End to end against real PostgreSQL through the real `buildApp()` (no mocks). Every fixture order
 * goes through the real cart -> checkout -> (approval) -> confirm flow.
 *
 * The critical case: an exceptional line (`order_items.is_exceptional_discount = true`) that has
 * **no `price_approvals` row at all** — reached by flipping the fixture tenant's
 * `tenant_price_policies.exceptional_discount_requires_approval` to `false` (there is no endpoint
 * for it; direct DB write into the disposable pg-verify database only) so a below-min order can be
 * confirmed with nothing filed. The filter must still surface it, proving the source of truth is
 * the frozen `order_items` flag and never a join to `price_approvals`.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: sales summary exceptional filter (integration, F18-06)', () => {
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
  const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  interface Fixture {
    admin: Session;
    tenantId: string;
    locationId: string;
    variantId: string;
    sku: string;
    customerId: string;
  }

  /** Variant with max=120 / base=100 / min=80 — a negotiated 70 is exceptional (below min) and
   * above any hard floor (default policy = no hard floor). */
  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
    const sku = `SKU-${uniq()}`;
    const { variantId } = await c.createProductVariant(admin, { sku, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, locationId, 1000);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, tenantId, locationId, variantId, sku, customerId };
  }

  async function addVariant(f: Fixture, min = 80): Promise<{ variantId: string; sku: string }> {
    const sku = `SKU-${uniq()}`;
    const { variantId } = await c.createProductVariant(f.admin, { sku, maxPrice: 120, basePrice: 100, minPrice: min });
    await c.receiveStock(f.admin, variantId, f.locationId, 1000);
    return { variantId, sku };
  }

  /** Direct DB — the fixture tenant no longer needs an approval to confirm a below-min order. */
  async function dropApprovalRequirement(tenantId: string): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      await db
        .insert(tenantPricePolicies)
        .values({ id: generateId(), tenantId, exceptionalDiscountRequiresApproval: false })
        .onConflictDoUpdate({
          target: tenantPricePolicies.tenantId,
          set: { exceptionalDiscountRequiresApproval: false },
        });
    } finally {
      await client.end();
    }
  }

  async function countApprovals(tenantId: string, orderId: string): Promise<number> {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db
        .select({ id: priceApprovals.id })
        .from(priceApprovals)
        .where(and(eq(priceApprovals.tenantId, tenantId), eq(priceApprovals.orderId, orderId)));
      return rows.length;
    } finally {
      await client.end();
    }
  }

  interface Line {
    variantId: string;
    quantity: number;
    negotiatedUnitPrice?: number;
  }

  /** cart -> checkout. Returns the pending order. */
  async function checkout(f: Fixture, session: Session, lines: Line[], customerId = f.customerId): Promise<{ id: string; items: { id: string; isExceptionalDiscount: boolean }[]; total: number }> {
    const cart = await c.inject({
      method: 'POST',
      url: '/api/v1/cart',
      headers: c.writeHeaders(session),
      payload: { locationId: f.locationId, customerId },
    });
    expect(cart.statusCode, cart.body).toBe(201);
    const cartId = (JSON.parse(cart.body) as { id: string }).id;
    for (const line of lines) {
      const added = await c.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        headers: c.writeHeaders(session),
        payload: {
          productVariantId: line.variantId,
          quantity: line.quantity,
          ...(line.negotiatedUnitPrice === undefined ? {} : { negotiatedUnitPrice: line.negotiatedUnitPrice }),
        },
      });
      expect(added.statusCode, added.body).toBe(200);
    }
    // Every fixture variant is max=120/base=100/min=80 (seed's own doc comment) — an unpriced line
    // defaults to basePrice (100) at checkout, same as `SalesPricingService.resolveUnitPrice`.
    const total = lines.reduce((sum, line) => sum + line.quantity * (line.negotiatedUnitPrice ?? 100), 0);
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(session, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    return { ...(JSON.parse(order.body) as { id: string; items: { id: string; isExceptionalDiscount: boolean }[] }), total };
  }

  async function confirm(session: Session, orderId: string, amount: number): Promise<void> {
    const res = await c.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/confirm`,
      headers: c.writeHeaders(session),
      payload: { payments: [{ paymentMethod: 'cash', amount }] },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  function summary(session: Session, query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return c.inject({ method: 'GET', url: `/api/v1/reports/sales-summary?${params}`, headers: c.readHeaders(session) });
  }

  interface PeriodBucket { key: string; orderCount: number; subtotal: number; discountTotal: number; total: number; avgTicket: number }
  interface ProductBucket { key: string; sku: string; productName: string; orderCount: number; quantity: number; discountTotal: number; total: number }
  interface Body { from: string; to: string; groupBy: string; exceptional: string; buckets: (PeriodBucket | ProductBucket & { customerName?: string })[] }

  const parse = (res: { body: string }): Body => JSON.parse(res.body) as Body;
  const orderTotal = (b: Body): number => b.buckets.reduce((n, x) => n + (x as PeriodBucket).orderCount, 0);

  // ---- the critical GAP case: exceptional WITHOUT any price_approvals row --------------------

  it('surfaces a confirmed exceptional order that has NO price_approvals row (source of truth = order_items flag)', async () => {
    const f = await seed('F1806 NoAppr Co', `admin@f1806-noappr-${uniq()}.example`);
    await dropApprovalRequirement(f.tenantId);

    const normal = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]); // 100, within range
    await confirm(f.admin, normal.id, normal.total);
    const exceptional = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1, negotiatedUnitPrice: 70 }]);
    expect(exceptional.items[0]!.isExceptionalDiscount).toBe(true);
    await confirm(f.admin, exceptional.id, exceptional.total);

    // Prove there is genuinely no approval row — the filter cannot be relying on a join.
    expect(await countApprovals(f.tenantId, exceptional.id)).toBe(0);

    const only = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'only' });
    expect(only.statusCode).toBe(200);
    expect(parse(only).exceptional).toBe('only');
    expect(orderTotal(parse(only))).toBe(1); // just the exceptional order
    expect(parse(only).buckets[0]!.total).toBe(70);

    const exclude = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'exclude' });
    expect(orderTotal(parse(exclude))).toBe(1); // just the normal order
    expect(parse(exclude).buckets[0]!.total).toBe(100);

    const all = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    expect(parse(all).exceptional).toBe('all');
    expect(orderTotal(parse(all))).toBe(2);
  });

  // ---- the approval path: still driven by the flag, not the approval status -----------------

  it('surfaces a confirmed exceptional order that DID go through an approved price_approvals request', async () => {
    const f = await seed('F1806 Appr Co', `admin@f1806-appr-${uniq()}.example`);
    const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.example`, 'Supervisor');

    const order = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 2, negotiatedUnitPrice: 70 }]);
    const orderItemId = order.items[0]!.id;
    const filed = await c.inject({
      method: 'POST',
      url: '/api/v1/price-approvals',
      headers: c.writeHeaders(f.admin),
      payload: { orderItemId, reason: 'matched a competitor quote for a long-standing customer' },
    });
    expect(filed.statusCode, filed.body).toBe(201);
    const approvalId = (JSON.parse(filed.body) as { id: string }).id;
    const approved = await c.inject({ method: 'POST', url: `/api/v1/price-approvals/${approvalId}/approve`, headers: c.writeHeaders(supervisor) });
    expect(approved.statusCode, approved.body).toBe(200);
    await confirm(f.admin, order.id, order.total);

    expect(await countApprovals(f.tenantId, order.id)).toBe(1);
    const only = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'only' });
    expect(orderTotal(parse(only))).toBe(1);
    expect(parse(only).buckets[0]!.total).toBe(140);
  });

  // ---- default / validation ---------------------------------------------------------------

  it('omitting `exceptional` behaves exactly like `all` (unchanged pre-F18-06 behaviour)', async () => {
    const f = await seed('F1806 Default Co', `admin@f1806-default-${uniq()}.example`);
    await dropApprovalRequirement(f.tenantId);
    const a = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
    await confirm(f.admin, a.id, a.total);
    const b = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1, negotiatedUnitPrice: 70 }]);
    await confirm(f.admin, b.id, b.total);

    const omitted = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    const explicitAll = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'all' });
    expect(orderTotal(parse(omitted))).toBe(2);
    expect(parse(omitted).buckets).toEqual(parse(explicitAll).buckets);
  });

  it('400 on an invalid `exceptional` value — never silently ignored', async () => {
    const f = await seed('F1806 Invalid Co', `admin@f1806-invalid-${uniq()}.example`);
    const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'maybe' });
    expect(res.statusCode).toBe(400);
  });

  it('an unauthenticated caller is 401 even with the filter', async () => {
    const res = await c.inject({
      method: 'GET',
      url: `/api/v1/reports/sales-summary?from=${HOUR_AGO}&to=${IN_AN_HOUR}&groupBy=day&exceptional=only`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('a Bodega user (no sales.orders.view) is 403 even with the filter', async () => {
    const f = await seed('F1806 Rbac Co', `admin@f1806-rbac-${uniq()}.example`);
    const bodega = await c.createAndLoginAs(f.admin, `bodega-${uniq()}@ex.example`, 'Bodega');
    const res = await summary(bodega, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'only' });
    expect(res.statusCode).toBe(403);
  });

  // ---- tenant isolation -------------------------------------------------------------------

  it('the filter never crosses tenants', async () => {
    const a = await seed('F1806 Iso A', `admin@f1806-iso-a-${uniq()}.example`);
    const b = await seed('F1806 Iso B', `admin@f1806-iso-b-${uniq()}.example`);
    await dropApprovalRequirement(a.tenantId);
    await dropApprovalRequirement(b.tenantId);
    const oa = await checkout(a, a.admin, [{ variantId: a.variantId, quantity: 1, negotiatedUnitPrice: 70 }]);
    await confirm(a.admin, oa.id, oa.total);
    const ob = await checkout(b, b.admin, [{ variantId: b.variantId, quantity: 1, negotiatedUnitPrice: 70 }]);
    await confirm(b.admin, ob.id, ob.total);

    const resA = await summary(a.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'only' });
    expect(orderTotal(parse(resA))).toBe(1);
    expect(parse(resA).buckets[0]!.total).toBe(70);
  });

  // ---- status interaction: exceptional PENDING order, no approval ------------------------

  it('composes with status — a pending exceptional order (no approval filed) shows under status=pending&exceptional=only', async () => {
    const f = await seed('F1806 Pending Co', `admin@f1806-pending-${uniq()}.example`);
    const pending = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1, negotiatedUnitPrice: 70 }]);
    expect(pending.items[0]!.isExceptionalDiscount).toBe(true);
    expect(await countApprovals(f.tenantId, pending.id)).toBe(0);

    const confirmedView = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'only' });
    expect(orderTotal(parse(confirmedView))).toBe(0); // default status=confirmed excludes it

    const pendingView = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', status: 'pending', exceptional: 'only' });
    expect(orderTotal(parse(pendingView))).toBe(1);
  });

  // ---- multi-line order: order grain vs line grain --------------------------------------

  it('a mixed-line order (one exceptional + one normal line): period grouping is order-grain, product grouping is line-grain', async () => {
    const f = await seed('F1806 Mixed Co', `admin@f1806-mixed-${uniq()}.example`);
    await dropApprovalRequirement(f.tenantId);
    const other = await addVariant(f);

    const mixed = await checkout(f, f.admin, [
      { variantId: f.variantId, quantity: 1, negotiatedUnitPrice: 70 }, // exceptional line, total 70
      { variantId: other.variantId, quantity: 1 }, // normal line, total 100
    ]);
    expect(mixed.items.find((i) => i.isExceptionalDiscount)).toBeTruthy();
    await confirm(f.admin, mixed.id, mixed.total);

    // period: the WHOLE order (170) is counted once under exceptional=only, and NOT at all under exclude.
    const only = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'only' });
    expect(orderTotal(parse(only))).toBe(1);
    expect(parse(only).buckets[0]!.total).toBe(170);
    const exclude = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'exclude' });
    expect(orderTotal(parse(exclude))).toBe(0);

    // product: only the exceptional variant's line appears under exceptional=only.
    const prodOnly = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'product', exceptional: 'only' });
    const prodBuckets = parse(prodOnly).buckets as ProductBucket[];
    expect(prodBuckets).toHaveLength(1);
    expect(prodBuckets[0]!.sku).toBe(f.sku);
    expect(prodBuckets[0]!.total).toBe(70);
    // discount vs max_price (120 - 70) * 1 = 50
    expect(prodBuckets[0]!.discountTotal).toBe(50);

    const prodExclude = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'product', exceptional: 'exclude' });
    const prodExBuckets = parse(prodExclude).buckets as ProductBucket[];
    expect(prodExBuckets).toHaveLength(1);
    expect(prodExBuckets[0]!.sku).toBe(other.sku);
  });

  // ---- grouping coverage --------------------------------------------------------------

  it('applies to groupBy=week/month/customer as well', async () => {
    const f = await seed('F1806 Grouping Co', `admin@f1806-grouping-${uniq()}.example`);
    await dropApprovalRequirement(f.tenantId);
    const normal = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
    await confirm(f.admin, normal.id, normal.total);
    const exc = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1, negotiatedUnitPrice: 70 }]);
    await confirm(f.admin, exc.id, exc.total);

    for (const groupBy of ['week', 'month', 'customer'] as const) {
      const only = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy, exceptional: 'only' });
      expect(only.statusCode, only.body).toBe(200);
      expect(orderTotal(parse(only))).toBe(1);
      expect(parse(only).buckets[0]!.total).toBe(70);
    }
  });

  // ---- empty result ------------------------------------------------------------------

  it('exceptional=only with no exceptional orders in range returns an empty buckets array (not an error)', async () => {
    const f = await seed('F1806 Empty Co', `admin@f1806-empty-${uniq()}.example`);
    const normal = await checkout(f, f.admin, [{ variantId: f.variantId, quantity: 1 }]);
    await confirm(f.admin, normal.id, normal.total);

    const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', exceptional: 'only' });
    expect(res.statusCode).toBe(200);
    expect(parse(res).buckets).toEqual([]);
    expect(parse(res).exceptional).toBe('only');
  });
});
