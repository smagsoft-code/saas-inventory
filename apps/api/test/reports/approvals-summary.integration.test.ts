import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * F18-05 — `GET /api/v1/reports/approvals-summary` end to end against real PostgreSQL, through the
 * real `buildApp()` (no mocks): RBAC (`pricing.discount.approve`), tenant isolation, `[from, to)`
 * boundary semantics on `price_approvals.requested_at`, the no-default-status behaviour, real
 * COUNT/SUM/FILTER aggregation (never a client-side fold), `approvalRate` math, and
 * day/week/month/status grouping. Every fixture approval goes through the real
 * checkout -> POST /price-approvals -> approve/reject/cancel lifecycle
 * (`sales-exceptional-pricing.integration.test.ts`'s own helper shapes) — no direct SQL insert into
 * `price_approvals`, so every fixture is exactly as valid as a real request.
 *
 * Variant pricing is fixed at maxPrice 120 / basePrice 100 / minPrice 80; a checkout unit price of
 * 60 is below min -> `is_exceptional_discount = true`, and `discount_amount = (120 - 60) * qty`
 * (computed vs max, never min — `PriceApprovalsService`), so every discount value below is
 * predictable.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: approvals summary (integration, F18-05)', () => {
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
    variantId: string;
    customerId: string;
  }

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, locationId, 500);
    const customerId = await c.createCustomer(admin, c.fullCustomer(email.split('@')[0]!));
    return { admin, tenantId, locationId, variantId, customerId };
  }

  /** A `pending` order with one below-min line (unit price 60 => exceptional). */
  async function pendingExceptionalOrder(f: Fixture, quantity = 1): Promise<{ orderId: string; orderItemId: string }> {
    const created = await c.inject({ method: 'POST', url: '/api/v1/cart', headers: c.writeHeaders(f.admin), payload: { locationId: f.locationId, customerId: f.customerId } });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({ method: 'POST', url: '/api/v1/cart/items', headers: c.writeHeaders(f.admin), payload: { productVariantId: f.variantId, quantity, negotiatedUnitPrice: 60 } });
    expect(added.statusCode, added.body).toBe(200);
    const order = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(f.admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(order.statusCode, order.body).toBe(201);
    const body = JSON.parse(order.body) as { id: string; items: { id: string; isExceptionalDiscount: boolean }[] };
    expect(body.items[0]!.isExceptionalDiscount).toBe(true);
    return { orderId: body.id, orderItemId: body.items[0]!.id };
  }

  const requestApproval = (session: Session, orderItemId: string, reason = 'integration test') =>
    c.inject({ method: 'POST', url: '/api/v1/price-approvals', headers: c.writeHeaders(session), payload: { orderItemId, reason } });

  /** Files a request (as admin) and returns its id + the `requestedAt` the server stamped. */
  async function fileRequest(f: Fixture, quantity = 1): Promise<{ approvalId: string; orderId: string; requestedAt: string }> {
    const { orderId, orderItemId } = await pendingExceptionalOrder(f, quantity);
    const req = await requestApproval(f.admin, orderItemId);
    expect(req.statusCode, req.body).toBe(201);
    const body = JSON.parse(req.body) as { id: string; requestedAt: string };
    return { approvalId: body.id, orderId, requestedAt: body.requestedAt };
  }

  async function approveAs(resolver: Session, approvalId: string): Promise<void> {
    const res = await c.inject({ method: 'POST', url: `/api/v1/price-approvals/${approvalId}/approve`, headers: c.writeHeaders(resolver) });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function rejectAs(resolver: Session, approvalId: string): Promise<void> {
    const res = await c.inject({ method: 'POST', url: `/api/v1/price-approvals/${approvalId}/reject`, headers: c.writeHeaders(resolver) });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function cancelOrder(f: Fixture, orderId: string): Promise<void> {
    const res = await c.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: c.writeHeaders(f.admin) });
    expect(res.statusCode, res.body).toBe(200);
  }

  function summary(session: Session, query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return c.inject({ method: 'GET', url: `/api/v1/reports/approvals-summary?${params}`, headers: c.readHeaders(session) });
  }

  const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  interface PeriodBucket {
    key: string;
    requestCount: number;
    approvedCount: number;
    rejectedCount: number;
    cancelledCount: number;
    pendingCount: number;
    approvedDiscountValue: number;
    approvalRate: number | null;
  }
  interface StatusBucket { key: string; requestCount: number; discountValue: number }
  interface SummaryBody {
    from: string;
    to: string;
    timezone: string;
    currency: string;
    groupBy: string;
    buckets: (PeriodBucket | StatusBucket)[];
  }

  describe('access control', () => {
    it('an unauthenticated caller is 401', async () => {
      const res = await c.inject({ method: 'GET', url: '/api/v1/reports/approvals-summary?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z' });
      expect(res.statusCode).toBe(401);
    });

    it('a Vendedor (pricing.discount.request but NOT .approve) is 403', async () => {
      const f = await seed('Appr Access Co', `admin@appr-access-${uniq()}.example`);
      const vendedor = await c.createAndLoginAs(f.admin, `vendedor-${uniq()}@ex.example`, 'Vendedor');
      const res = await summary(vendedor, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(res.statusCode).toBe(403);
    });

    it('an Administrador (pricing.discount.approve granted by default) gets 200', async () => {
      const f = await seed('Appr Access OK Co', `admin@appr-access-ok-${uniq()}.example`);
      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('a Supervisor (pricing.discount.approve, not .request) also gets 200', async () => {
      const f = await seed('Appr Access Sup Co', `admin@appr-access-sup-${uniq()}.example`);
      const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.example`, 'Supervisor');
      const res = await summary(supervisor, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  describe('query validation', () => {
    it('400 when `from` is missing', async () => {
      const f = await seed('Appr QV1 Co', `admin@appr-qv1-${uniq()}.example`);
      expect((await summary(f.admin, { to: IN_AN_HOUR })).statusCode).toBe(400);
    });

    it('400 when `to` is missing', async () => {
      const f = await seed('Appr QV2 Co', `admin@appr-qv2-${uniq()}.example`);
      expect((await summary(f.admin, { from: HOUR_AGO })).statusCode).toBe(400);
    });

    it('400 when `from` is not strictly before `to`', async () => {
      const f = await seed('Appr QV3 Co', `admin@appr-qv3-${uniq()}.example`);
      expect((await summary(f.admin, { from: IN_AN_HOUR, to: HOUR_AGO })).statusCode).toBe(400);
    });

    it('400 on an invalid groupBy value — never silently ignored', async () => {
      const f = await seed('Appr QV4 Co', `admin@appr-qv4-${uniq()}.example`);
      expect((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'requester' })).statusCode).toBe(400);
    });

    it('400 on an invalid status value', async () => {
      const f = await seed('Appr QV5 Co', `admin@appr-qv5-${uniq()}.example`);
      expect((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, status: 'resolved' })).statusCode).toBe(400);
    });

    it('an invalid date string is 400', async () => {
      const f = await seed('Appr QV6 Co', `admin@appr-qv6-${uniq()}.example`);
      expect((await summary(f.admin, { from: 'not-a-date', to: IN_AN_HOUR })).statusCode).toBe(400);
    });
  });

  describe('empty state', () => {
    it('a brand-new tenant with zero approvals gets 200 and an empty buckets array', async () => {
      const f = await seed('Appr Empty Co', `admin@appr-empty-${uniq()}.example`);
      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.buckets).toEqual([]);
      expect(body.groupBy).toBe('day');
      expect(body.currency).toBe('USD');
      expect(body.timezone).toBe('UTC');
    });
  });

  describe('tenant isolation', () => {
    it("tenant A never sees tenant B's approvals in the summary", async () => {
      const a = await seed('Appr Iso A', `admin@appr-iso-a-${uniq()}.example`);
      const b = await seed('Appr Iso B', `admin@appr-iso-b-${uniq()}.example`);
      const supA = await c.createAndLoginAs(a.admin, `sup-a-${uniq()}@ex.example`, 'Supervisor');
      const supB = await c.createAndLoginAs(b.admin, `sup-b-${uniq()}@ex.example`, 'Supervisor');

      const ra = await fileRequest(a);
      await approveAs(supA, ra.approvalId);
      const rb1 = await fileRequest(b);
      await approveAs(supB, rb1.approvalId);
      await fileRequest(b); // a second, still-pending B request

      const bodyA = JSON.parse((await summary(a.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' })).body) as SummaryBody;
      const bodyB = JSON.parse((await summary(b.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' })).body) as SummaryBody;
      expect((bodyA.buckets as PeriodBucket[]).reduce((n, x) => n + x.requestCount, 0)).toBe(1);
      expect((bodyB.buckets as PeriodBucket[]).reduce((n, x) => n + x.requestCount, 0)).toBe(2);
      expect((bodyA.buckets[0] as PeriodBucket).approvedCount).toBe(1);
      expect((bodyB.buckets[0] as PeriodBucket).approvedCount).toBe(1);
      expect((bodyB.buckets[0] as PeriodBucket).pendingCount).toBe(1);
    });
  });

  describe('[from, to) boundary semantics on requested_at', () => {
    it('a request filed exactly at `to` is excluded; the same instant as `from` is included', async () => {
      const f = await seed('Appr Boundary Co', `admin@appr-boundary-${uniq()}.example`);
      const { requestedAt } = await fileRequest(f);
      const oneMsLater = new Date(new Date(requestedAt).getTime() + 1).toISOString();

      const excluded = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: requestedAt })).body) as SummaryBody;
      expect((excluded.buckets as PeriodBucket[]).reduce((n, x) => n + x.requestCount, 0)).toBe(0);

      const includedByTo = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: oneMsLater })).body) as SummaryBody;
      expect((includedByTo.buckets as PeriodBucket[]).reduce((n, x) => n + x.requestCount, 0)).toBe(1);

      const includedByFrom = JSON.parse((await summary(f.admin, { from: requestedAt, to: IN_AN_HOUR })).body) as SummaryBody;
      expect((includedByFrom.buckets as PeriodBucket[]).reduce((n, x) => n + x.requestCount, 0)).toBe(1);
    });
  });

  describe('aggregation correctness', () => {
    it('period bucket counts/discount/rate match a known set of approved + rejected + pending + cancelled requests', async () => {
      const f = await seed('Appr Agg Co', `admin@appr-agg-${uniq()}.example`);
      const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.example`, 'Supervisor');

      // 3 approved (discount 60 each), 1 rejected, 2 pending, 1 cancelled = 7 requests filed.
      for (let i = 0; i < 3; i += 1) {
        const r = await fileRequest(f);
        await approveAs(supervisor, r.approvalId);
      }
      const rej = await fileRequest(f);
      await rejectAs(supervisor, rej.approvalId);
      await fileRequest(f);
      await fileRequest(f);
      const toCancel = await fileRequest(f);
      await cancelOrder(f, toCancel.orderId);

      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.buckets).toHaveLength(1);
      const bucket = body.buckets[0] as PeriodBucket;
      expect(bucket.requestCount).toBe(7);
      expect(bucket.approvedCount).toBe(3);
      expect(bucket.rejectedCount).toBe(1);
      expect(bucket.pendingCount).toBe(2);
      expect(bucket.cancelledCount).toBe(1);
      expect(bucket.approvedDiscountValue).toBe(180); // 3 * (120 - 60) * 1
      expect(bucket.approvalRate).toBe(0.75); // 3 / (3 + 1) — cancelled + pending excluded
    });

    it('approvedDiscountValue scales with the order-line quantity (discount is per unit, vs max price)', async () => {
      const f = await seed('Appr Qty Co', `admin@appr-qty-${uniq()}.example`);
      const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.example`, 'Supervisor');
      const r = await fileRequest(f, 4); // discount_amount = (120 - 60) * 4 = 240
      await approveAs(supervisor, r.approvalId);

      const body = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' })).body) as SummaryBody;
      expect((body.buckets[0] as PeriodBucket).approvedDiscountValue).toBe(240);
    });

    it('multiple approvals are each counted once — no join fan-out (price_approvals is queried alone)', async () => {
      const f = await seed('Appr Multi Co', `admin@appr-multi-${uniq()}.example`);
      for (let i = 0; i < 5; i += 1) await fileRequest(f);
      const body = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' })).body) as SummaryBody;
      expect((body.buckets[0] as PeriodBucket).requestCount).toBe(5);
      expect((body.buckets[0] as PeriodBucket).pendingCount).toBe(5);
    });
  });

  describe('status filter (no default)', () => {
    it('omitting status includes every status; status=approved narrows to approved only', async () => {
      const f = await seed('Appr Status Co', `admin@appr-status-${uniq()}.example`);
      const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.example`, 'Supervisor');
      const a = await fileRequest(f);
      await approveAs(supervisor, a.approvalId);
      const rj = await fileRequest(f);
      await rejectAs(supervisor, rj.approvalId);
      await fileRequest(f); // pending

      const all = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' })).body) as SummaryBody;
      expect((all.buckets[0] as PeriodBucket).requestCount).toBe(3);

      const approvedOnly = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', status: 'approved' })).body) as SummaryBody;
      const b = approvedOnly.buckets[0] as PeriodBucket;
      expect(b.requestCount).toBe(1);
      expect(b.approvedCount).toBe(1);
      expect(b.rejectedCount).toBe(0);
      expect(b.pendingCount).toBe(0);
      expect(b.approvedDiscountValue).toBe(60);
    });
  });

  describe('groupBy variants', () => {
    it('groupBy=day/week/month each return a single well-formed bucket for a same-day fixture set', async () => {
      const f = await seed('Appr GroupBy Co', `admin@appr-groupby-${uniq()}.example`);
      const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.example`, 'Supervisor');
      const r = await fileRequest(f);
      await approveAs(supervisor, r.approvalId);
      await fileRequest(f);

      for (const groupBy of ['day', 'week', 'month'] as const) {
        const body = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy })).body) as SummaryBody;
        expect(body.groupBy).toBe(groupBy);
        expect(body.buckets).toHaveLength(1);
        const bucket = body.buckets[0] as PeriodBucket;
        expect(bucket.requestCount).toBe(2);
        expect(bucket.approvedCount).toBe(1);
        expect(bucket.approvalRate).toBe(1); // 1 approved / (1 + 0 rejected)
        expect(/^\d{4}-\d{2}-\d{2}$/.test(bucket.key)).toBe(true);
      }
    });

    it('groupBy=status returns one bucket per real status with requestCount + discountValue, never approvalRate', async () => {
      const f = await seed('Appr ByStatus Co', `admin@appr-bystatus-${uniq()}.example`);
      const supervisor = await c.createAndLoginAs(f.admin, `sup-${uniq()}@ex.example`, 'Supervisor');
      const a1 = await fileRequest(f);
      await approveAs(supervisor, a1.approvalId);
      const a2 = await fileRequest(f);
      await approveAs(supervisor, a2.approvalId);
      const rj = await fileRequest(f);
      await rejectAs(supervisor, rj.approvalId);
      await fileRequest(f); // pending

      const body = JSON.parse((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'status' })).body) as SummaryBody;
      const byKey = new Map((body.buckets as StatusBucket[]).map((b) => [b.key, b]));
      expect(byKey.get('approved')!.requestCount).toBe(2);
      expect(byKey.get('approved')!.discountValue).toBe(120); // 2 * 60
      expect(byKey.get('rejected')!.requestCount).toBe(1);
      expect(byKey.get('rejected')!.discountValue).toBe(60);
      expect(byKey.get('pending')!.requestCount).toBe(1);
      expect(byKey.get('approved')).not.toHaveProperty('approvalRate');
    });
  });
});
