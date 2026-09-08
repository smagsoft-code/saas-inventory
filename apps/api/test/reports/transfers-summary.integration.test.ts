import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * F18-08 — `GET /api/v1/reports/transfers-summary` end to end against real PostgreSQL, through the
 * real `buildApp()` (no mocks): RBAC (`inventory.view`), tenant isolation, the `status` rollup, the
 * in-transit aggregate by destination / by variant (`TRF-INTRANSIT-QTY` — `Σ (dispatched −
 * received)` over `dispatched`/`partially_received` transfers), grain safety (a multi-line transfer
 * counts once, never once per line), and the empty case. Every fixture transfer is produced by the
 * real transfer lifecycle (`POST /inventory/transfers` → approve → prepare → dispatch → receive) —
 * no direct SQL into `inventory_transfers`/`inventory_transfer_items`.
 *
 * One shared fixture tenant (`beforeAll`) — each test uses fresh variants / destination locations so
 * tests never contaminate each other's aggregates (the `status` rollup is tenant-wide so those
 * assertions use deltas). Only the isolation test provisions a second tenant.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: transfers summary (integration, F18-08)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let f: Fixture;

  interface Fixture {
    admin: Session;
    tenantId: string;
    warehouseId: string;
    sourceLocationId: string;
  }

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function seed(company: string, email: string): Promise<Fixture> {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${uniq()}`);
    const sourceLocationId = await c.createLocation(admin, warehouseId, `SRC-${uniq()}`);
    return { admin, tenantId: admin.user.tenantId, warehouseId, sourceLocationId };
  }

  async function addVariant(fx: Fixture): Promise<string> {
    const { variantId } = await c.createProductVariant(fx.admin, { sku: `SKU-${uniq()}` });
    return variantId;
  }

  const addLocation = (fx: Fixture) => c.createLocation(fx.admin, fx.warehouseId, `L-${uniq()}`);

  async function createTransfer(
    fx: Fixture,
    destinationLocationId: string,
    items: { variantId: string; requested: number }[],
  ): Promise<string> {
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: c.writeHeaders(fx.admin),
      payload: {
        sourceLocationId: fx.sourceLocationId,
        destinationLocationId,
        items: items.map((i) => ({ productVariantId: i.variantId, quantityRequested: i.requested })),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  }

  async function post(fx: Fixture, transferId: string, action: string, payload?: unknown): Promise<void> {
    const res = await c.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferId}/${action}`,
      headers: c.writeHeaders(fx.admin),
      ...(payload === undefined ? {} : { payload }),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function items(fx: Fixture, transferId: string): Promise<{ id: string }[]> {
    const res = await c.inject({ method: 'GET', url: `/api/v1/inventory/transfers/${transferId}`, headers: c.readHeaders(fx.admin) });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { items: { id: string }[] }).items;
  }

  /** Create a transfer, stock the source, and drive it to `dispatched` (full dispatch). Returns the
   * transfer id and its item ids. Optionally receive some quantity to leave it `partially_received`. */
  async function openTransfer(
    fx: Fixture,
    destinationLocationId: string,
    lines: { variantId: string; requested: number; received?: number }[],
  ): Promise<string> {
    for (const l of lines) await c.receiveStock(fx.admin, l.variantId, fx.sourceLocationId, l.requested + 10);
    const transferId = await createTransfer(fx, destinationLocationId, lines);
    await post(fx, transferId, 'approve');
    await post(fx, transferId, 'prepare');
    await post(fx, transferId, 'dispatch', {});
    const toReceive = lines.filter((l) => (l.received ?? 0) > 0);
    if (toReceive.length > 0) {
      const itemRows = await items(fx, transferId);
      // items come back in insertion order; map by index
      const payloadItems = lines
        .map((l, idx) => ({ l, idx }))
        .filter(({ l }) => (l.received ?? 0) > 0)
        .map(({ l, idx }) => ({ transferItemId: itemRows[idx]!.id, quantityReceived: l.received }));
      const res = await c.inject({
        method: 'POST',
        url: `/api/v1/inventory/transfers/${transferId}/receive`,
        headers: c.writeHeaders(fx.admin, { 'idempotency-key': `recv-${transferId}-${uniq()}` }),
        payload: { items: payloadItems },
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    return transferId;
  }

  function summary(session: Session, groupBy?: string) {
    const qs = groupBy ? `?groupBy=${groupBy}` : '';
    return c.inject({ method: 'GET', url: `/api/v1/reports/transfers-summary${qs}`, headers: c.readHeaders(session) });
  }

  interface Body {
    generatedAt: string;
    groupBy: string;
    totals: { inTransitQuantity: number; openTransferCount: number };
    buckets: Record<string, unknown>[];
  }
  const parse = (res: { body: string }): Body => JSON.parse(res.body) as Body;

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    f = await seed('TransferSummary Co', `admin@transfer-summary-${uniq()}.example`);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- access control ---------------------------------------------------------------

  it('an unauthenticated caller is 401', async () => {
    const res = await c.inject({ method: 'GET', url: '/api/v1/reports/transfers-summary?groupBy=status' });
    expect(res.statusCode).toBe(401);
  });

  it('requires inventory.view — a Vendedor (no inventory.view in the default template) is 403', async () => {
    const vendedor = await c.createAndLoginAs(f.admin, `vendedor-${uniq()}@ex.example`, 'Vendedor');
    expect((await summary(vendedor, 'status')).statusCode).toBe(403);
  });

  it('a Bodega user (inventory.view granted) gets 200', async () => {
    const bodega = await c.createAndLoginAs(f.admin, `bodega-${uniq()}@ex.example`, 'Bodega');
    expect((await summary(bodega, 'status')).statusCode).toBe(200);
  });

  it('400 on an invalid groupBy — never silently ignored', async () => {
    expect((await summary(f.admin, 'cycle-time')).statusCode).toBe(400);
  });

  it('defaults to groupBy=status when the param is omitted', async () => {
    const res = await summary(f.admin);
    expect(res.statusCode).toBe(200);
    expect(parse(res).groupBy).toBe('status');
  });

  // ---- status rollup ---------------------------------------------------------------

  it('groupBy=status counts each transfer once, by its real status (delta assertions — tenant-wide)', async () => {
    const before = parse(await summary(f.admin, 'status'));
    const countFor = (b: Body, status: string) =>
      (b.buckets.find((x) => x['key'] === status)?.['transferCount'] as number | undefined) ?? 0;

    const dest = await addLocation(f);
    const v = await addVariant(f);
    // one dispatched, one still draft, one cancelled
    await openTransfer(f, dest, [{ variantId: v, requested: 5 }]);
    const draftId = await createTransfer(f, dest, [{ variantId: v, requested: 1 }]);
    const cancelId = await createTransfer(f, dest, [{ variantId: v, requested: 1 }]);
    await post(f, cancelId, 'cancel');

    const after = parse(await summary(f.admin, 'status'));
    expect(countFor(after, 'dispatched') - countFor(before, 'dispatched')).toBe(1);
    expect(countFor(after, 'draft') - countFor(before, 'draft')).toBe(1);
    expect(countFor(after, 'cancelled') - countFor(before, 'cancelled')).toBe(1);
    expect(draftId).toBeTruthy();
  });

  // ---- in-transit by destination -------------------------------------------------

  it('groupBy=destination: Σ (dispatched − received) per destination, name-resolved, open transfers counted once', async () => {
    const dest = await addLocation(f);
    const v1 = await addVariant(f);
    const v2 = await addVariant(f);
    // ONE transfer, TWO lines: 10 dispatched (0 received) + 8 dispatched (3 received) => in transit 10 + 5 = 15
    await openTransfer(f, dest, [
      { variantId: v1, requested: 10 },
      { variantId: v2, requested: 8, received: 3 },
    ]);

    const res = await summary(f.admin, 'destination');
    expect(res.statusCode).toBe(200);
    const bucket = parse(res).buckets.find((b) => b['key'] === dest);
    expect(bucket).toBeDefined();
    expect(bucket!['destinationName']).toMatch(/^Loc /);
    expect(bucket!['inTransitQuantity']).toBe(15);
    expect(bucket!['openTransferCount']).toBe(1); // one transfer, not one-per-line
  });

  it('a fully received transfer leaves its destination out of the in-transit aggregate', async () => {
    const dest = await addLocation(f);
    const v = await addVariant(f);
    await openTransfer(f, dest, [{ variantId: v, requested: 6, received: 6 }]); // fully received => status received

    const res = await summary(f.admin, 'destination');
    expect(parse(res).buckets.find((b) => b['key'] === dest)).toBeUndefined();
  });

  // ---- in-transit by variant ---------------------------------------------------

  it('groupBy=variant: Σ (dispatched − received) per variant across every open transfer, sku-resolved', async () => {
    const destA = await addLocation(f);
    const destB = await addLocation(f);
    const v = await addVariant(f);
    await openTransfer(f, destA, [{ variantId: v, requested: 4 }]); // 4 in transit
    await openTransfer(f, destB, [{ variantId: v, requested: 9, received: 2 }]); // 7 in transit

    const res = await summary(f.admin, 'variant');
    const bucket = parse(res).buckets.find((b) => b['key'] === v);
    expect(bucket).toBeDefined();
    expect(bucket!['sku']).toMatch(/^SKU-/);
    expect(bucket!['productName']).toMatch(/^Product SKU-/);
    expect(bucket!['inTransitQuantity']).toBe(11); // 4 + 7
  });

  // ---- totals -------------------------------------------------------------------

  it('totals.inTransitQuantity and totals.openTransferCount are groupBy-independent', async () => {
    const status = parse(await summary(f.admin, 'status'));
    const dest = parse(await summary(f.admin, 'destination'));
    expect(status.totals).toEqual(dest.totals);
    expect(status.totals.openTransferCount).toBeGreaterThan(0);
    expect(status.totals.inTransitQuantity).toBeGreaterThan(0);
  });

  // ---- tenant isolation -------------------------------------------------------

  it("tenant A never sees tenant B's transfers", async () => {
    const b = await seed('TransferSummary Iso B', `admin@transfer-iso-b-${uniq()}.example`);
    const destB = await addLocation(b);
    const vB = await addVariant(b);
    await openTransfer(b, destB, [{ variantId: vB, requested: 500 }]);

    const resB = await summary(b.admin, 'destination');
    const bucketB = parse(resB).buckets.find((x) => x['key'] === destB);
    expect(bucketB!['inTransitQuantity']).toBe(500);

    // tenant A's aggregate must not include tenant B's 500
    const resA = await summary(f.admin, 'variant');
    expect(parse(resA).buckets.find((x) => x['key'] === vB)).toBeUndefined();
    expect(parse(resA).totals.inTransitQuantity).toBeLessThan(500);
  });

  // ---- empty -----------------------------------------------------------------

  it('a tenant with no open transfers returns 200 with buckets: [] and zeroed totals', async () => {
    const fresh = await seed('TransferSummary Empty', `admin@transfer-empty-${uniq()}.example`);
    const res = await summary(fresh.admin, 'destination');
    expect(res.statusCode).toBe(200);
    expect(parse(res).buckets).toEqual([]);
    expect(parse(res).totals).toEqual({ inTransitQuantity: 0, openTransferCount: 0 });
    expect(parse(res)).not.toHaveProperty('currency');
  });
});
