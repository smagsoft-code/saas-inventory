import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';

/**
 * F18-03 — `GET /api/v1/reports/inventory-summary` end to end against real PostgreSQL, through the
 * real `buildApp()` (no mocks): tenant isolation, RBAC, warehouse/category grouping, real SQL
 * SUM/COUNT aggregation (never a client-side fold over raw balance rows), `outOfStockCount`'s
 * distinct-variant semantics, and the `warehouseId`/`categoryId` filters. Every fixture balance is
 * produced by a real adjustment or a real cart→checkout reservation (never a direct SQL insert into
 * `inventory_balances`), so every fixture is exactly as valid as a real stock movement.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('reports: inventory summary (integration, F18-03)', () => {
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

  async function registerTenantOnly(company: string, email: string): Promise<Session> {
    return c.registerTenant(company, email);
  }

  async function createCategory(admin: Session, name: string): Promise<string> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + `-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await c.inject({ method: 'POST', url: '/api/v1/categories', headers: c.writeHeaders(admin), payload: { name, slug } });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  }

  async function createProductWithCategory(admin: Session, sku: string, categoryId?: string): Promise<{ productId: string; variantId: string }> {
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: c.writeHeaders(admin),
      payload: {
        name: `Product ${sku}`,
        ...(categoryId ? { categoryId } : {}),
        defaultVariant: { sku, maxPrice: 100, basePrice: 90, minPrice: 80 },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const productId = (JSON.parse(res.body) as { id: string }).id;
    const variants = await c.inject({ method: 'GET', url: `/api/v1/products/${productId}/variants`, headers: c.readHeaders(admin) });
    expect(variants.statusCode).toBe(200);
    return { productId, variantId: (JSON.parse(variants.body) as { id: string }[])[0]!.id };
  }

  async function receive(admin: Session, variantId: string, locationId: string, quantity: number): Promise<void> {
    await c.receiveStock(admin, variantId, locationId, quantity);
  }

  async function depleteToZero(admin: Session, variantId: string, locationId: string, quantity: number): Promise<void> {
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: c.writeHeaders(admin),
      payload: { productVariantId: variantId, locationId, movementType: 'ADJUSTMENT_OUT', quantity, reason: 'Deplete to zero' },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  /** Leaves a `pending` order — a real `RESERVATION` movement, never confirmed/cancelled — so
   * `quantity_reserved` rises and `quantity_available` falls without touching `quantity_physical`. */
  async function reserve(admin: Session, locationId: string, variantId: string, quantity: number): Promise<void> {
    const customer = await c.createCustomer(admin, c.fullCustomer(`res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`));
    const created = await c.inject({
      method: 'POST',
      url: '/api/v1/cart',
      headers: c.writeHeaders(admin),
      payload: { locationId, customerId: customer },
    });
    expect(created.statusCode, created.body).toBe(201);
    const cartId = (JSON.parse(created.body) as { id: string }).id;
    const added = await c.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: c.writeHeaders(admin),
      payload: { productVariantId: variantId, quantity },
    });
    expect(added.statusCode, added.body).toBe(200);
    const ordered = await c.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: c.writeHeaders(admin, { 'idempotency-key': randomUUID() }),
      payload: { cartId, documentType: 'sales_note' },
    });
    expect(ordered.statusCode, ordered.body).toBe(201);
  }

  function summary(session: Session, query: Record<string, string> = {}) {
    const params = new URLSearchParams(query).toString();
    return c.inject({ method: 'GET', url: `/api/v1/reports/inventory-summary${params ? `?${params}` : ''}`, headers: c.readHeaders(session) });
  }

  interface WarehouseBucket {
    key: string;
    warehouseName: string;
    availableQuantity: number;
    reservedQuantity: number;
    outOfStockCount: number;
  }
  interface CategoryBucket {
    key: string;
    categoryName: string;
    availableQuantity: number;
    reservedQuantity: number;
    outOfStockCount: number;
  }
  interface SummaryBody {
    generatedAt: string;
    groupBy: string;
    totals: { availableQuantity: number; reservedQuantity: number; outOfStockCount: number };
    buckets: (WarehouseBucket | CategoryBucket)[];
  }

  describe('access control', () => {
    it('requires inventory.view — a Vendedor user (no inventory.view in the default template) is 403', async () => {
      const admin = await registerTenantOnly('InvSummary Access Co', 'admin@inv-summary-access.example');
      const vendedor = await c.createAndLoginAs(admin, 'vendedor@inv-summary-access.example', 'Vendedor');
      const res = await summary(vendedor);
      expect(res.statusCode).toBe(403);
    });

    it('an unauthenticated caller is 401', async () => {
      const res = await c.inject({ method: 'GET', url: '/api/v1/reports/inventory-summary' });
      expect(res.statusCode).toBe(401);
    });

    it('a Bodega user (inventory.view granted) gets 200', async () => {
      const admin = await registerTenantOnly('InvSummary Bodega Co', 'admin@inv-summary-bodega.example');
      const bodega = await c.createAndLoginAs(admin, 'bodega@inv-summary-bodega.example', 'Bodega');
      const res = await summary(bodega);
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  describe('empty state', () => {
    it('a brand-new tenant with zero balances gets 200, zero totals, empty buckets — never an error', async () => {
      const admin = await registerTenantOnly('InvSummary Empty Co', 'admin@inv-summary-empty.example');
      const res = await summary(admin);
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.totals).toEqual({ availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 0 });
      expect(body.buckets).toEqual([]);
      expect(body.groupBy).toBe('warehouse');
    });
  });

  describe('aggregation correctness', () => {
    it('availableQuantity/reservedQuantity match real receipts and a real pending-order reservation exactly', async () => {
      const admin = await registerTenantOnly('InvSummary Agg Co', 'admin@inv-summary-agg.example');
      const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}`);
      const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}`);
      const { variantId } = await createProductWithCategory(admin, `SKU-${Date.now()}-agg`);

      await receive(admin, variantId, locationId, 100);
      await reserve(admin, locationId, variantId, 20);

      const res = await summary(admin);
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.totals.availableQuantity).toBe(80);
      expect(body.totals.reservedQuantity).toBe(20);
      expect(body.totals.outOfStockCount).toBe(0);

      expect(body.buckets).toHaveLength(1);
      const bucket = body.buckets[0] as WarehouseBucket;
      expect(bucket.key).toBe(warehouseId);
      expect(bucket.availableQuantity).toBe(80);
      expect(bucket.reservedQuantity).toBe(20);
      expect(bucket.outOfStockCount).toBe(0);
    });
  });

  describe('groupBy=warehouse', () => {
    it('produces one bucket per warehouse with the correct per-warehouse sums', async () => {
      const admin = await registerTenantOnly('InvSummary WH Co', 'admin@inv-summary-wh.example');
      const whA = await c.createWarehouse(admin, `WHA-${Date.now()}`);
      const locA = await c.createLocation(admin, whA, `LA-${Date.now()}`);
      const whB = await c.createWarehouse(admin, `WHB-${Date.now()}`);
      const locB = await c.createLocation(admin, whB, `LB-${Date.now()}`);
      const { variantId: v1 } = await createProductWithCategory(admin, `SKU-${Date.now()}-wh1`);
      const { variantId: v2 } = await createProductWithCategory(admin, `SKU-${Date.now()}-wh2`);

      await receive(admin, v1, locA, 30);
      await receive(admin, v2, locB, 45);

      const res = await summary(admin, { groupBy: 'warehouse' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      const byKey = new Map((body.buckets as WarehouseBucket[]).map((b) => [b.key, b]));
      expect(byKey.get(whA)!.availableQuantity).toBe(30);
      expect(byKey.get(whB)!.availableQuantity).toBe(45);
      expect(byKey.get(whA)!.warehouseName).toBeTruthy();
    });

    it('does not double-count a variant depleted across two locations in the same warehouse as two out-of-stock SKUs', async () => {
      const admin = await registerTenantOnly('InvSummary OOS Co', 'admin@inv-summary-oos.example');
      const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}`);
      const locA = await c.createLocation(admin, warehouseId, `LA-${Date.now()}`);
      const locB = await c.createLocation(admin, warehouseId, `LB-${Date.now()}`);
      const { variantId } = await createProductWithCategory(admin, `SKU-${Date.now()}-oos`);

      await receive(admin, variantId, locA, 5);
      await receive(admin, variantId, locB, 3);
      await depleteToZero(admin, variantId, locA, 5);
      await depleteToZero(admin, variantId, locB, 3);

      const res = await summary(admin, { warehouseId });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.totals.outOfStockCount).toBe(1);
      expect(body.buckets).toHaveLength(1);
      expect((body.buckets[0] as WarehouseBucket).outOfStockCount).toBe(1);
    });
  });

  describe('groupBy=category', () => {
    it('groups by category, and buckets a product with no category under the explicit "uncategorized" sentinel', async () => {
      const admin = await registerTenantOnly('InvSummary Cat Co', 'admin@inv-summary-cat.example');
      const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}`);
      const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}`);
      const categoryA = await createCategory(admin, `Category A ${Date.now()}`);
      const categoryB = await createCategory(admin, `Category B ${Date.now()}`);
      const { variantId: vA } = await createProductWithCategory(admin, `SKU-${Date.now()}-catA`, categoryA);
      const { variantId: vB } = await createProductWithCategory(admin, `SKU-${Date.now()}-catB`, categoryB);
      const { variantId: vNone } = await createProductWithCategory(admin, `SKU-${Date.now()}-catNone`);

      await receive(admin, vA, locationId, 10);
      await receive(admin, vB, locationId, 20);
      await receive(admin, vNone, locationId, 5);

      const res = await summary(admin, { groupBy: 'category' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      const byKey = new Map((body.buckets as CategoryBucket[]).map((b) => [b.key, b]));
      expect(byKey.get(categoryA)!.availableQuantity).toBe(10);
      expect(byKey.get(categoryB)!.availableQuantity).toBe(20);
      expect(byKey.get('uncategorized')!.availableQuantity).toBe(5);
      expect(byKey.get('uncategorized')!.categoryName).toBe('Uncategorized');
    });
  });

  describe('filters', () => {
    it('warehouseId narrows both totals and buckets to that warehouse only', async () => {
      const admin = await registerTenantOnly('InvSummary Filter Co', 'admin@inv-summary-filter.example');
      const whA = await c.createWarehouse(admin, `WHA-${Date.now()}`);
      const locA = await c.createLocation(admin, whA, `LA-${Date.now()}`);
      const whB = await c.createWarehouse(admin, `WHB-${Date.now()}`);
      const locB = await c.createLocation(admin, whB, `LB-${Date.now()}`);
      const { variantId: v1 } = await createProductWithCategory(admin, `SKU-${Date.now()}-filterA`);
      const { variantId: v2 } = await createProductWithCategory(admin, `SKU-${Date.now()}-filterB`);
      await receive(admin, v1, locA, 12);
      await receive(admin, v2, locB, 34);

      const res = await summary(admin, { warehouseId: whA });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.totals.availableQuantity).toBe(12);
      expect(body.buckets).toHaveLength(1);
      expect((body.buckets[0] as WarehouseBucket).key).toBe(whA);
    });

    it('an invalid (well-formed but non-existent) warehouseId returns 200 with empty/zeroed results, never an error', async () => {
      const admin = await registerTenantOnly('InvSummary Invalid Co', 'admin@inv-summary-invalid.example');
      const res = await summary(admin, { warehouseId: '00000000-0000-0000-0000-000000000000' });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as SummaryBody;
      expect(body.totals).toEqual({ availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 0 });
      expect(body.buckets).toEqual([]);
    });

    it('a malformed warehouseId (not a UUID) is 400', async () => {
      const admin = await registerTenantOnly('InvSummary Malformed Co', 'admin@inv-summary-malformed.example');
      const res = await summary(admin, { warehouseId: 'not-a-uuid' });
      expect(res.statusCode).toBe(400);
    });

    it('an invalid groupBy value is 400, never silently ignored', async () => {
      const admin = await registerTenantOnly('InvSummary GroupBy Co', 'admin@inv-summary-groupby.example');
      const res = await summary(admin, { groupBy: 'location' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('tenant isolation', () => {
    it("tenant A never sees tenant B's inventory in the summary", async () => {
      const a = await registerTenantOnly('InvSummary Iso A', 'admin@inv-summary-iso-a.example');
      const b = await registerTenantOnly('InvSummary Iso B', 'admin@inv-summary-iso-b.example');
      const whA = await c.createWarehouse(a, `WHA-${Date.now()}`);
      const locA = await c.createLocation(a, whA, `LA-${Date.now()}`);
      const { variantId: vA } = await createProductWithCategory(a, `SKU-${Date.now()}-isoA`);
      await receive(a, vA, locA, 7);

      const whB = await c.createWarehouse(b, `WHB-${Date.now()}`);
      const locB = await c.createLocation(b, whB, `LB-${Date.now()}`);
      const { variantId: vB } = await createProductWithCategory(b, `SKU-${Date.now()}-isoB`);
      await receive(b, vB, locB, 99);

      const resA = await summary(a);
      const resB = await summary(b);
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
      const bodyA = JSON.parse(resA.body) as SummaryBody;
      const bodyB = JSON.parse(resB.body) as SummaryBody;
      expect(bodyA.totals.availableQuantity).toBe(7);
      expect(bodyB.totals.availableQuantity).toBe(99);
      expect(bodyA.buckets.map((bk) => bk.key)).not.toContain(whB);
      expect(bodyB.buckets.map((bk) => bk.key)).not.toContain(whA);
    });
  });
});
