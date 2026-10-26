import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv } from '../sales/sales-harness';

/**
 * F18-03 — `GAP-MOVEMENTS-DATE-FILTER`: `occurredFrom`/`occurredTo` on
 * `GET /api/v1/inventory/movements`, filtered on `inventory_movements.occurred_at` (the canonical
 * "when the physical movement happened" timestamp — never `created_at`), half-open `[from, to)`.
 * Every fixture movement goes through the real `POST /inventory/adjustments` endpoint (never a
 * direct SQL insert), using its `occurredAt` backdating field to place movements exactly at the
 * boundaries under test.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('inventory: movements occurredFrom/occurredTo (integration, F18-03)', () => {
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

  async function seed(company: string, email: string) {
    const admin = await c.registerTenant(company, email);
    const warehouseId = await c.createWarehouse(admin, `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const locationId = await c.createLocation(admin, warehouseId, `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const { variantId } = await c.createProductVariant(admin, { sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    return { admin, locationId, variantId };
  }

  async function adjustAt(
    session: Awaited<ReturnType<typeof c.registerTenant>>,
    locationId: string,
    variantId: string,
    occurredAt: string,
    reason: string,
  ): Promise<void> {
    const res = await c.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: c.writeHeaders(session),
      payload: { productVariantId: variantId, locationId, movementType: 'RECEIPT', quantity: 1, unitCost: 10, reason, occurredAt },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  function listMovements(session: Awaited<ReturnType<typeof c.registerTenant>>, query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return c.inject({ method: 'GET', url: `/api/v1/inventory/movements?${params}`, headers: c.readHeaders(session) });
  }

  describe('[occurredFrom, occurredTo) boundary semantics', () => {
    it('from-1 excluded, from included, interior included, to excluded, to+1 excluded', async () => {
      const { admin, locationId, variantId } = await seed('Kardex Boundary Co', 'admin@kardex-boundary.example');

      const from = new Date('2026-06-15T00:00:00.000Z');
      const to = new Date('2026-06-16T00:00:00.000Z');
      const fromMinus1 = new Date(from.getTime() - 1).toISOString();
      const fromIso = from.toISOString();
      const interior = new Date(from.getTime() + 12 * 60 * 60 * 1000).toISOString();
      const toIso = to.toISOString();
      const toPlus1 = new Date(to.getTime() + 1).toISOString();

      await adjustAt(admin, locationId, variantId, fromMinus1, 'boundary-from-minus-1');
      await adjustAt(admin, locationId, variantId, fromIso, 'boundary-from');
      await adjustAt(admin, locationId, variantId, interior, 'boundary-interior');
      await adjustAt(admin, locationId, variantId, toIso, 'boundary-to');
      await adjustAt(admin, locationId, variantId, toPlus1, 'boundary-to-plus-1');

      const res = await listMovements(admin, { productVariantId: variantId, occurredFrom: fromIso, occurredTo: toIso, pageSize: '50' });
      expect(res.statusCode, res.body).toBe(200);
      const reasons = (JSON.parse(res.body) as { data: { reason: string }[] }).data.map((m) => m.reason).sort();
      expect(reasons).toEqual(['boundary-from', 'boundary-interior'].sort());
    });

    it('occurredFrom alone applies an inclusive lower bound with no upper bound', async () => {
      const { admin, locationId, variantId } = await seed('Kardex FromOnly Co', 'admin@kardex-fromonly.example');
      const from = new Date('2026-06-15T00:00:00.000Z');
      await adjustAt(admin, locationId, variantId, new Date(from.getTime() - 1).toISOString(), 'before');
      await adjustAt(admin, locationId, variantId, from.toISOString(), 'at-from');
      await adjustAt(admin, locationId, variantId, new Date(from.getTime() + 1000).toISOString(), 'after');

      const res = await listMovements(admin, { productVariantId: variantId, occurredFrom: from.toISOString(), pageSize: '50' });
      expect(res.statusCode, res.body).toBe(200);
      const reasons = (JSON.parse(res.body) as { data: { reason: string }[] }).data.map((m) => m.reason).sort();
      expect(reasons).toEqual(['at-from', 'after'].sort());
    });

    it('occurredTo alone applies an exclusive upper bound with no lower bound', async () => {
      const { admin, locationId, variantId } = await seed('Kardex ToOnly Co', 'admin@kardex-toonly.example');
      const to = new Date('2026-06-15T00:00:00.000Z');
      await adjustAt(admin, locationId, variantId, new Date(to.getTime() - 1000).toISOString(), 'before');
      await adjustAt(admin, locationId, variantId, to.toISOString(), 'at-to');
      await adjustAt(admin, locationId, variantId, new Date(to.getTime() + 1).toISOString(), 'after');

      const res = await listMovements(admin, { productVariantId: variantId, occurredTo: to.toISOString(), pageSize: '50' });
      expect(res.statusCode, res.body).toBe(200);
      const reasons = (JSON.parse(res.body) as { data: { reason: string }[] }).data.map((m) => m.reason).sort();
      expect(reasons).toEqual(['before']);
    });
  });

  describe('validation', () => {
    it('400 when occurredFrom is not strictly before occurredTo', async () => {
      const { admin } = await seed('Kardex Invalid Co', 'admin@kardex-invalid.example');
      const same = new Date().toISOString();
      const res = await listMovements(admin, { occurredFrom: same, occurredTo: same });
      expect(res.statusCode).toBe(400);
    });

    it('400 on a malformed occurredFrom/occurredTo value', async () => {
      const { admin } = await seed('Kardex Malformed Co', 'admin@kardex-malformed.example');
      const res = await listMovements(admin, { occurredFrom: 'not-a-date' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('no regression', () => {
    it('omitting occurredFrom/occurredTo returns every movement, exactly as before this phase', async () => {
      const { admin, locationId, variantId } = await seed('Kardex Regression Co', 'admin@kardex-regression.example');
      await adjustAt(admin, locationId, variantId, new Date('2020-01-01T00:00:00.000Z').toISOString(), 'ancient');
      await adjustAt(admin, locationId, variantId, new Date().toISOString(), 'recent');

      const res = await listMovements(admin, { productVariantId: variantId, pageSize: '50' });
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as { data: unknown[] }).data).toHaveLength(2);
    });
  });
});
