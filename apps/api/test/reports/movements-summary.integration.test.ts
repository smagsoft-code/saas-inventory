import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * F18-07 — `GET /api/v1/reports/movements-summary` end to end against real PostgreSQL, through the
 * real `buildApp()` (no mocks): RBAC (`inventory.view`), tenant isolation, `[from, to)` boundary
 * semantics on `inventory_movements.occurred_at`, real COUNT/SUM aggregation (never a client-side
 * fold), the signed `Σ quantity`, `movementType`/`locationId`/`productVariantId` filters, and
 * day/week/month/type grouping. Every fixture movement is produced by a real
 * `POST /inventory/adjustments` (with the backdatable `occurredAt` field) — no direct SQL insert
 * into `inventory_movements`, so every fixture is exactly as valid as a real stock movement.
 *
 * One shared fixture tenant (`beforeAll`) — each test creates a fresh variant and scopes its query
 * to that variant (or a disjoint time window), so tests never see each other's movements without
 * needing a tenant per test. Only the isolation test provisions a second tenant.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: movements summary (integration, F18-07)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let f: Fixture;

  interface Fixture {
    admin: Session;
    tenantId: string;
    warehouseId: string;
    locationId: string;
  }

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const tenantId = admin.user.tenantId;
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${uniq()}`);
    return { admin, tenantId, warehouseId, locationId };
  }

  async function addVariant(fx: Fixture): Promise<string> {
    const { variantId } = await c.createProductVariant(fx.admin, { sku: `SKU-${uniq()}`, maxPrice: 120, basePrice: 100, minPrice: 80 });
    return variantId;
  }

  async function addLocation(fx: Fixture): Promise<string> {
    return c.createLocation(fx.admin, fx.warehouseId, `L-${uniq()}`);
  }

  /** A real ledger movement via POST /inventory/adjustments, at an explicit occurred_at. */
  async function move(
    session: Session,
    opts: {
      variantId: string;
      locationId: string;
      movementType: 'RECEIPT' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
      quantity: number;
      occurredAt: string;
    },
  ): Promise<void> {
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: c.writeHeaders(session),
      payload: {
        productVariantId: opts.variantId,
        locationId: opts.locationId,
        movementType: opts.movementType,
        quantity: opts.quantity,
        // RECEIPT requires a unit cost (ADR-0037); the other movement types omit it.
        ...(opts.movementType === 'RECEIPT' ? { unitCost: 10 } : {}),
        reason: 'F18-07 integration fixture',
        occurredAt: opts.occurredAt,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  function summary(session: Session, query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return c.inject({ method: 'GET', url: `/api/v1/reports/movements-summary?${params}`, headers: c.readHeaders(session) });
  }

  interface Bucket {
    key: string;
    movementCount: number;
    totalQuantity: number;
  }
  interface Body {
    from: string;
    to: string;
    timezone: string;
    groupBy: string;
    buckets: Bucket[];
  }
  const parse = (res: { body: string }): Body => JSON.parse(res.body) as Body;
  const sumCount = (b: Body): number => b.buckets.reduce((n, x) => n + x.movementCount, 0);
  const sumQty = (b: Body): number => b.buckets.reduce((n, x) => n + x.totalQuantity, 0);

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    f = await seed('MovSummary Co', `admin@mov-summary-${uniq()}.example`);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- access control -------------------------------------------------------------------

  it('an unauthenticated caller is 401', async () => {
    const res = await c.inject({
      method: 'GET',
      url: `/api/v1/reports/movements-summary?from=${HOUR_AGO}&to=${IN_AN_HOUR}&groupBy=day`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('requires inventory.view — a user whose role lacks inventory.view is 403', async () => {
    await c.createRole(f.admin, 'Sin permisos');
    const vendedor = await c.createAndLoginAs(f.admin, `sinpermisos-${uniq()}@ex.example`, 'Sin permisos');
    const res = await summary(vendedor, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    expect(res.statusCode).toBe(403);
  });

  it('a Bodega user (inventory.view granted) gets 200', async () => {
    const bodega = await c.createAndLoginAs(f.admin, `bodega-${uniq()}@ex.example`, 'Bodega');
    const res = await summary(bodega, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    expect(res.statusCode).toBe(200);
  });

  // ---- query validation ---------------------------------------------------------------

  it('400 when `from`/`to` missing or from >= to', async () => {
    expect((await summary(f.admin, { to: IN_AN_HOUR, groupBy: 'day' })).statusCode).toBe(400);
    expect((await summary(f.admin, { from: HOUR_AGO, groupBy: 'day' })).statusCode).toBe(400);
    expect((await summary(f.admin, { from: IN_AN_HOUR, to: HOUR_AGO, groupBy: 'day' })).statusCode).toBe(400);
  });

  it('400 on an invalid groupBy or movementType — never silently ignored', async () => {
    expect((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'actor' })).statusCode).toBe(400);
    expect((await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', movementType: 'GIVEAWAY' })).statusCode).toBe(400);
  });

  // ---- tenant isolation ---------------------------------------------------------------

  it('tenant A never sees tenant B\'s movements', async () => {
    const variantA = await addVariant(f);
    await move(f.admin, { variantId: variantA, locationId: f.locationId, movementType: 'RECEIPT', quantity: 10, occurredAt: new Date().toISOString() });

    const b = await seed('MovSummary Iso B', `admin@mov-iso-b-${uniq()}.example`);
    const variantB = await addVariant(b);
    await move(b.admin, { variantId: variantB, locationId: b.locationId, movementType: 'RECEIPT', quantity: 999, occurredAt: new Date().toISOString() });

    const resA = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', productVariantId: variantA });
    expect(resA.statusCode).toBe(200);
    expect(sumCount(parse(resA))).toBe(1);
    expect(sumQty(parse(resA))).toBe(10);

    const resB = await summary(b.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day' });
    expect(sumQty(parse(resB))).toBe(999); // only its own
  });

  // ---- [from, to) boundary -----------------------------------------------------------

  it('a movement exactly at `to` is excluded; one exactly at `from` is included', async () => {
    const variantId = await addVariant(f);
    const from = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const to = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const before = new Date(from.getTime() - 60_000).toISOString();
    const interior = new Date((from.getTime() + to.getTime()) / 2).toISOString();
    const after = new Date(to.getTime() + 60_000).toISOString();

    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 8, occurredAt: before });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 1, occurredAt: from.toISOString() });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 2, occurredAt: interior });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 4, occurredAt: to.toISOString() });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 16, occurredAt: after });

    const res = await summary(f.admin, { from: from.toISOString(), to: to.toISOString(), groupBy: 'month', productVariantId: variantId });
    expect(res.statusCode).toBe(200);
    expect(sumCount(parse(res))).toBe(2); // from + interior only
    expect(sumQty(parse(res))).toBe(3); // 1 + 2
  });

  // ---- aggregation correctness + signed sum -----------------------------------------

  it('groupBy=type: exact COUNT / signed SUM per movement type (RECEIPT +, ADJUSTMENT_OUT -)', async () => {
    const variantId = await addVariant(f);
    const now = () => new Date().toISOString();
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 100, occurredAt: now() });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 20, occurredAt: now() });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'ADJUSTMENT_IN', quantity: 5, occurredAt: now() });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'ADJUSTMENT_OUT', quantity: 3, occurredAt: now() });

    const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'type', productVariantId: variantId });
    expect(res.statusCode).toBe(200);
    const byKey = Object.fromEntries(parse(res).buckets.map((b) => [b.key, b]));
    expect(byKey['RECEIPT']).toEqual({ key: 'RECEIPT', movementCount: 2, totalQuantity: 120 });
    expect(byKey['ADJUSTMENT_IN']).toEqual({ key: 'ADJUSTMENT_IN', movementCount: 1, totalQuantity: 5 });
    expect(byKey['ADJUSTMENT_OUT']).toEqual({ key: 'ADJUSTMENT_OUT', movementCount: 1, totalQuantity: -3 });
    expect(sumQty(parse(res))).toBe(122); // 120 + 5 - 3
  });

  it('groupBy=day/week/month all produce a real YYYY-MM-DD key and the same totals; no currency field', async () => {
    const variantId = await addVariant(f);
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 7, occurredAt: new Date().toISOString() });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 3, occurredAt: new Date().toISOString() });

    for (const groupBy of ['day', 'week', 'month'] as const) {
      const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy, productVariantId: variantId });
      expect(res.statusCode, res.body).toBe(200);
      const body = parse(res);
      expect(body.buckets).toHaveLength(1);
      expect(body.buckets[0]!.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.buckets[0]!.movementCount).toBe(2);
      expect(body.buckets[0]!.totalQuantity).toBe(10);
      expect(body).not.toHaveProperty('currency');
    }
  });

  // ---- composition: filters ---------------------------------------------------------

  it('movementType filter narrows both the count and the signed sum', async () => {
    const variantId = await addVariant(f);
    const now = () => new Date().toISOString();
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 50, occurredAt: now() });
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'ADJUSTMENT_OUT', quantity: 4, occurredAt: now() });

    const receipts = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', productVariantId: variantId, movementType: 'RECEIPT' });
    expect(sumCount(parse(receipts))).toBe(1);
    expect(sumQty(parse(receipts))).toBe(50);

    const outs = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', productVariantId: variantId, movementType: 'ADJUSTMENT_OUT' });
    expect(sumQty(parse(outs))).toBe(-4);
  });

  it('locationId and productVariantId filters restrict to that location / variant only', async () => {
    const variantId = await addVariant(f);
    const otherVariant = await addVariant(f);
    const otherLocation = await addLocation(f);
    const now = () => new Date().toISOString();
    await move(f.admin, { variantId, locationId: f.locationId, movementType: 'RECEIPT', quantity: 10, occurredAt: now() });
    await move(f.admin, { variantId, locationId: otherLocation, movementType: 'RECEIPT', quantity: 100, occurredAt: now() });
    await move(f.admin, { variantId: otherVariant, locationId: f.locationId, movementType: 'RECEIPT', quantity: 1000, occurredAt: now() });

    // location f.locationId, but any variant among the two we just made: 10 + 1000
    const byLoc = await summary(f.admin, {
      from: HOUR_AGO,
      to: IN_AN_HOUR,
      groupBy: 'type',
      locationId: f.locationId,
    });
    const locReceipt = parse(byLoc).buckets.find((b) => b.key === 'RECEIPT');
    // other tests also RECEIPT into f.locationId with their own variants — assert our two are counted
    expect(locReceipt).toBeDefined();
    expect(locReceipt!.totalQuantity).toBeGreaterThanOrEqual(1010);

    const byVariant = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', productVariantId: variantId });
    expect(sumQty(parse(byVariant))).toBe(110); // 10 + 100

    const both = await summary(f.admin, {
      from: HOUR_AGO,
      to: IN_AN_HOUR,
      groupBy: 'day',
      locationId: f.locationId,
      productVariantId: variantId,
    });
    expect(sumQty(parse(both))).toBe(10);
  });

  // ---- empty ----------------------------------------------------------------------

  it('a range with no movements returns 200 with buckets: [] (never an error)', async () => {
    const freshVariant = await addVariant(f);
    const res = await summary(f.admin, { from: HOUR_AGO, to: IN_AN_HOUR, groupBy: 'day', productVariantId: freshVariant });
    expect(res.statusCode).toBe(200);
    expect(parse(res).buckets).toEqual([]);
    expect(parse(res).groupBy).toBe('day');
  });
});
