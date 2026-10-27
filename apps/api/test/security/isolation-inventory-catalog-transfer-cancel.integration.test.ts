import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import { eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, expectNoLeak, uniq, withDb } from './iso-helpers';

/**
 * FASE 19 — HTTP audit of three surfaces left "unverified" by the earlier passes:
 *  - `GET /reports/inventory-summary` (`inventory.view`; field-gated cost totals, ADR-0028);
 *  - `GET /reports/product-catalog` (`products.view`; max/base price only);
 *  - `POST /inventory/transfers/:id/cancel` (`inventory.transfers.approve`) and the question whether its `notes` can persist.
 * Two tenants with different, exactly known stock so an aggregate that mixed tenants would show a wrong NUMBER, not only a wrong name.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('inventory-summary, product-catalog and transfer cancel — isolation (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');
  const CANCEL_NOTES = `NOTA-CANCELA-${stamp()}`.toUpperCase();
  const CREATE_NOTES = `NOTA-CREA-${stamp()}`.toUpperCase();

  interface Tenant {
    admin: Session;
    tenantId: string;
    warehouseId: string;
    locA: string;
    locB: string;
    categoryId: string;
    variantId: string;
    sku: string;
    stock: number;
  }
  let A: Tenant;
  let B: Tenant;
  let seller: Session;
  let supervisor: Session;
  let bodega: Session;
  let invOnly: Session;
  let noPerm: Session;

  const post = (s: Session, url: string, payload?: unknown) => c.inject({ method: 'POST', url, headers: c.writeHeaders(s), ...(payload !== undefined ? { payload } : {}) });
  const get = (s: Session | undefined, url: string) => c.inject({ method: 'GET', url, headers: s ? c.readHeaders(s) : {} });
  const json = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;
  const ok = (res: LightMyRequestResponse) => {
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    return res;
  };

  async function seedTenant(label: string, stock: number): Promise<Tenant> {
    const admin = await c.registerTenant(`Iso Inv ${label} ${stamp()}`, `iso-inv-${label}-${stamp()}@example.com`);
    const warehouseId = await c.createWarehouse(admin, `ISOIW${label}-${stamp()}`);
    const locA = await c.createLocation(admin, warehouseId, `ISOIA${label}-${stamp()}`);
    const locB = await c.createLocation(admin, warehouseId, `ISOIB${label}-${stamp()}`);
    const category = await c.inject({ method: 'POST', url: '/api/v1/categories', headers: c.writeHeaders(admin), payload: { name: `Cat ${label} ${stamp()}`, code: `CAT${label}${stamp()}`.toUpperCase().slice(0, 20) } });
    expect(category.statusCode, category.body).toBe(201);
    const sku = `ISOI${label}-${stamp()}`.toUpperCase();
    const { variantId } = await c.createProductVariant(admin, { sku, maxPrice: 120, basePrice: 100, minPrice: 80 });
    await c.receiveStock(admin, variantId, locA, stock);
    return { admin, tenantId: admin.user.tenantId, warehouseId, locA, locB, categoryId: json<{ id: string }>(category).id, variantId, sku, stock };
  }

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    A = await seedTenant('A', 40);
    B = await seedTenant('B', 70);

    const role = async (name: string, codes: string[]): Promise<Session> => {
      await c.createRole(A.admin, name, [...new Set(codes)]);
      const s = await c.createAndLoginAs(A.admin, `${stamp()}-${name.toLowerCase().replace(/\W+/g, '')}@example.com`, name);
      await c.setUserLocations(A.admin, s.user.id, [A.locA, A.locB]);
      return s;
    };
    seller = await role('Vendedor inv', DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes);
    invOnly = await role('Solo inventario', ['inventory.view', 'products.view']);
    noPerm = await role('Sin permisos inv', []);
    supervisor = await c.createAndLoginAs(A.admin, `${stamp()}-supervisor@example.com`, 'Supervisor');
    bodega = await c.createAndLoginAs(A.admin, `${stamp()}-bodega@example.com`, 'Bodega');
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  type Summary = { totals: { availableQuantity: number; totalCostValue?: number; missingCostCount?: number }; buckets: Array<{ key: string; warehouseName?: string; categoryName?: string; availableQuantity: number }> };
  const summaryUrl = (extra = '') => `/api/v1/reports/inventory-summary?${extra.replace(/^&/, '')}`;

  it('ISO-LED-19 inventory-summary: exact per-tenant totals, tenant-wide for inventory.view holders (pinned), cost totals field-gated, foreign filters empty, errors clean', async () => {
    const a = json<Summary>(ok(await get(A.admin, summaryUrl())));
    const b = json<Summary>(ok(await get(B.admin, summaryUrl())));
    expect(a.totals.availableQuantity, 'A: exactly its own stock').toBe(40);
    expect(b.totals.availableQuantity, 'B: exactly its own stock — nothing of A is added').toBe(70);
    expect(a.buckets.map((x) => x.key)).toEqual([A.warehouseId]);
    expect(b.buckets.map((x) => x.key)).toEqual([B.warehouseId]);
    expectNoLeak(JSON.stringify(b), [A.warehouseId, A.locA, A.locB, A.tenantId, A.sku, A.categoryId], 'B inventory-summary');
    ok(await get(A.admin, summaryUrl('groupBy=category')));

    // tenant-wide by design (ADR-0024: reads are not location-scoped): every inventory.view holder gets the same aggregate
    for (const [name, who] of [['seller', seller], ['Supervisor', supervisor], ['Bodega', bodega], ['inventory-only', invOnly]] as Array<[string, Session]>) {
      expect(json<Summary>(ok(await get(who, summaryUrl()))).totals.availableQuantity, `${name} sees the tenant's stock`).toBe(40);
    }
    // field gating (ADR-0028): the cost totals need pricing.cost.view, which the admin has and an inventory-only role does not
    // the total is Σ product_variants.cost × physical (current-cost valuation); the fixture variant has no cost, so it is 0 with one variant missing a cost
    expect(a.totals.totalCostValue, 'admin sees the cost total').toBe(0);
    expect(a.totals.missingCostCount, 'admin sees the missing-cost count').toBe(1);
    const gated = json<Summary>(ok(await get(invOnly, summaryUrl()))).totals;
    expect(gated).not.toHaveProperty('totalCostValue');
    expect(gated).not.toHaveProperty('missingCostCount');

    // filters: own ids narrow, foreign ids give an empty aggregate (never the other tenant's numbers)
    expect(json<Summary>(ok(await get(A.admin, summaryUrl(`warehouseId=${A.warehouseId}`)))).totals.availableQuantity).toBe(40);
    expect(json<Summary>(ok(await get(A.admin, summaryUrl(`locationId=${A.locB}`)))).totals.availableQuantity, 'an empty own location').toBe(0);
    for (const filter of [`warehouseId=${B.warehouseId}`, `locationId=${B.locA}`, `categoryId=${B.categoryId}`]) {
      const res = await get(A.admin, summaryUrl(filter));
      expect([200, 400, 404], `A with B ${filter} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
      if (res.statusCode === 200) {
        const body = json<Summary>(res);
        expect(body.totals.availableQuantity, `A with B ${filter}: never B's 70`).toBe(0);
        expect(body.buckets.every((x) => x.availableQuantity === 0), `A with B ${filter}: empty buckets`).toBe(true);
      }
      expectNoLeak(res.body, [B.warehouseId, B.locA, B.tenantId, B.sku], `A inventory-summary with B ${filter}`);
    }
    // an empty answer must not let the caller tell "exists in another tenant" from "does not exist"
    const unknown = await get(A.admin, summaryUrl('warehouseId=00000000-0000-4000-8000-000000000000'));
    const foreign = await get(A.admin, summaryUrl(`warehouseId=${B.warehouseId}`));
    expect({ s: foreign.statusCode, t: json<Summary>(foreign).totals.availableQuantity }).toEqual({ s: unknown.statusCode, t: json<Summary>(unknown).totals.availableQuantity });

    expectDenied(await get(noPerm, summaryUrl()), [403], 'no permission');
    expectDenied(await get(undefined, summaryUrl()), [401], 'anonymous');
    for (const bad of ['warehouseId=nope', 'groupBy=location', 'locationId=1', 'categoryId=%00']) {
      const res = await get(A.admin, summaryUrl(bad));
      expectDenied(res, [400], `bad input ${bad}`);
      expectNoLeak(res.body, [A.tenantId, B.tenantId, B.sku], `error body for ${bad}`);
    }
  });

  type Catalog = { data: Array<Record<string, unknown>>; meta: { total: number; page: number; pageSize: number; totalPages: number } };
  const catalogUrl = (extra = '') => `/api/v1/reports/product-catalog?pageSize=50${extra}`;

  it('ISO-LED-20 product-catalog: own tenant only, foreign ids / search / pagination reveal nothing, no cost or floor price in any row, no seller-scope parameter to abuse', async () => {
    const a = json<Catalog>(ok(await get(A.admin, catalogUrl())));
    const b = json<Catalog>(ok(await get(B.admin, catalogUrl())));
    expect(a.meta.total, 'A: its single variant').toBe(1);
    expect(b.meta.total, 'B: its single variant').toBe(1);
    expect(a.data[0]!['sku']).toBe(A.sku);
    expect(b.data[0]!['sku']).toBe(B.sku);
    expect(a.data[0]!['availableQuantity']).toBe(40);
    expect(b.data[0]!['availableQuantity'], "B's own number, not A's").toBe(70);
    expectNoLeak(JSON.stringify(b), [A.sku, A.variantId, A.tenantId, A.categoryId], 'B catalog');

    // ADR-0028: the catalog row has max/base price only — never cost nor the floor price, for anyone
    for (const [name, who] of [['admin', A.admin], ['seller', seller], ['inventory-only', invOnly]] as Array<[string, Session]>) {
      const rows = json<Catalog>(ok(await get(who, catalogUrl()))).data;
      for (const row of rows) for (const forbidden of ['cost', 'unitCost', 'minPrice', 'averageCost']) expect(row, `${name}: ${forbidden}`).not.toHaveProperty(forbidden);
    }

    // foreign identifiers and searches from B: empty, with a meta that reveals nothing
    for (const filter of [`&variantId=${A.variantId}`, `&q=${A.sku}`, `&q=${A.sku.slice(0, 8)}`, `&categoryId=${A.categoryId}`, `&locationId=${A.locA}&stock=with`]) {
      const res = await get(B.admin, catalogUrl(filter));
      expect([200, 400, 404], `B with A ${filter} -> ${res.body.slice(0, 160)}`).toContain(res.statusCode);
      if (res.statusCode === 200) {
        const body = json<Catalog>(res);
        expect(body.data.some((row) => row['sku'] === A.sku || row['variantId'] === A.variantId), `B with A ${filter}`).toBe(false);
        expect(body.data.some((row) => row['availableQuantity'] === 40), `B with A ${filter}: A's number`).toBe(false);
      }
      expectNoLeak(res.body, [A.sku, A.variantId, A.tenantId], `B catalog with ${filter}`);
    }
    // A search cannot distinguish "another tenant has it" from "nobody has it"
    const absent = json<Catalog>(ok(await get(B.admin, catalogUrl(`&q=ISOI-NOBODY-${stamp()}`))));
    const foreign = json<Catalog>(ok(await get(B.admin, catalogUrl(`&q=${A.sku}`))));
    expect(foreign.meta).toEqual(absent.meta);
    expect(foreign.data).toEqual(absent.data);
    // wildcard characters stay inside the tenant
    for (const q of ['%25', '_']) {
      const res = json<Catalog>(ok(await get(B.admin, catalogUrl(`&q=${q}`))));
      expect(res.data.every((row) => row['sku'] === B.sku), `q=${q} stays in tenant B`).toBe(true);
    }
    // pagination past the end: an empty page; by documented design the total of a 0-row page is 0 (it rides on the returned rows)
    const past = json<Catalog>(ok(await get(A.admin, `/api/v1/reports/product-catalog?page=9&pageSize=5`)));
    expect(past.data).toEqual([]);
    expect(past.meta.total).toBe(0);
    // the report has no seller dimension: seller / tenant steering parameters are refused, not silently honoured
    for (const bad of ['placedByUserId=00000000-0000-4000-8000-000000000000', `tenantId=${B.tenantId}`, 'sellerId=1']) {
      expectDenied(await get(seller, catalogUrl(`&${bad}`)), [400], `unknown parameter ${bad}`);
    }
    expectDenied(await get(seller, catalogUrl('&variantId=nope')), [400], 'malformed variant id');
    expectDenied(await get(noPerm, catalogUrl()), [403], 'no permission');
    expectDenied(await get(undefined, catalogUrl()), [401], 'anonymous');
  });

  const transferRow = (id: string) => withDb(async (db) => (await db.select().from(schema.inventoryTransfers).where(eq(schema.inventoryTransfers.id, id)))[0]);
  async function newTransfer(t: Tenant, notes?: string): Promise<string> {
    const res = await post(t.admin, '/api/v1/inventory/transfers', { sourceLocationId: t.locA, destinationLocationId: t.locB, ...(notes ? { notes } : {}), items: [{ productVariantId: t.variantId, quantityRequested: 2 }] });
    expect(res.statusCode, res.body).toBe(201);
    return json<{ id: string }>(res).id;
  }

  it('ISO-LED-21 transfer cancel: the route takes no body, so `notes` (and any other field) is ignored and persisted nowhere; permissions and tenant isolation hold; state read back from the database', async () => {
    const id = await newTransfer(A, CREATE_NOTES);
    const before = await transferRow(id);
    expect(before?.status).toBe('draft');

    // refusals leave the row untouched
    expectDenied(await post(seller, `/api/v1/inventory/transfers/${id}/cancel`, { notes: CANCEL_NOTES }), [403], 'seller cancels');
    expectDenied(await post(noPerm, `/api/v1/inventory/transfers/${id}/cancel`), [403], 'no permission cancels');
    expectDenied(await c.inject({ method: 'POST', url: `/api/v1/inventory/transfers/${id}/cancel` }), [401, 403], 'anonymous cancels');
    expectDenied(await post(B.admin, `/api/v1/inventory/transfers/${id}/cancel`, { notes: CANCEL_NOTES }), [404], 'tenant B cancels the transfer of A');
    expectDenied(await post(A.admin, '/api/v1/inventory/transfers/not-a-uuid/cancel'), [400], 'malformed id');
    expect(await transferRow(id), 'a refused cancel changes nothing').toEqual(before);

    // the roles the templates grant `inventory.transfers.approve` to may cancel — derived from the real templates, not assumed
    const canCancel = (role: 'Supervisor' | 'Bodega'): boolean => DEFAULT_ROLE_TEMPLATES[role].permissionCodes.includes('inventory.transfers.approve');
    const bodegaTry = await post(bodega, `/api/v1/inventory/transfers/${await newTransfer(A)}/cancel`);
    expect(bodegaTry.statusCode === 200, `Bodega cancel -> ${bodegaTry.statusCode}`).toBe(canCancel('Bodega'));
    const supTry = await post(supervisor, `/api/v1/inventory/transfers/${await newTransfer(A)}/cancel`);
    expect(supTry.statusCode === 200, `Supervisor cancel -> ${supTry.statusCode}`).toBe(canCancel('Supervisor'));

    // the contract has no body: extra fields are ignored (200), never stored
    const cancelled = await post(A.admin, `/api/v1/inventory/transfers/${id}/cancel`, { notes: CANCEL_NOTES, status: 'received', sourceLocationId: B.locA, cancelledAt: '2000-01-01T00:00:00Z' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const after = await transferRow(id);
    expect(after?.status).toBe('cancelled');
    expect(after?.notes, 'the create-time notes are unchanged; the cancel notes were not stored').toBe(CREATE_NOTES);
    expect(after?.sourceLocationId).toBe(A.locA);
    expect(new Date(after!.cancelledAt!).getFullYear(), 'cancelledAt is the server clock, not the body').toBeGreaterThan(2020);
    expect(cancelled.body.includes(CANCEL_NOTES), 'the response does not echo the ignored field').toBe(false);
    // nowhere in the tenant's persisted data: transfer rows, receipts, audit trail
    const persisted = await withDb(async (db) =>
      JSON.stringify({
        transfers: await db.select().from(schema.inventoryTransfers).where(eq(schema.inventoryTransfers.tenantId, A.tenantId)),
        receipts: await db.select().from(schema.inventoryTransferReceipts).where(eq(schema.inventoryTransferReceipts.tenantId, A.tenantId)),
        audit: await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, A.tenantId)),
      }),
    );
    expect(persisted.includes(CANCEL_NOTES), 'the cancel notes were persisted somewhere').toBe(false);
    // a second cancel is a clean 409 and still stores nothing
    expectDenied(await post(A.admin, `/api/v1/inventory/transfers/${id}/cancel`, { notes: CANCEL_NOTES }), [409], 'cancelling twice');
    // tenant B can cancel its own and is unaffected by A's
    const own = await newTransfer(B);
    expect((await post(B.admin, `/api/v1/inventory/transfers/${own}/cancel`)).statusCode).toBe(200);
    expect((await transferRow(own))?.status).toBe('cancelled');
  });
});
