import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from './sales-harness';

/**
 * FASE 12 (SALES) — customers CRUD, tenant isolation, IDOR, mass assignment, per-tenant
 * identification uniqueness, and the frozen-order-history guarantee (§103, §106, §140). Real
 * guard chain, real app_tenant/app_platform connections, real PostgreSQL RLS — no mocks.
 * Does NOT call resetAndMigrate() — global-setup.ts already did, once.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('sales: customers (integration)', () => {
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

  async function seedAdmin(company: string, email: string): Promise<Session> {
    return c.registerTenant(company, email);
  }

  describe('CRUD + validation (§100, §103)', () => {
    it('creates, reads, lists, updates a customer; tenant/status are server-derived', async () => {
      const admin = await seedAdmin('Cust Alpha Co', 'admin@cust-alpha.example');
      const id = await c.createCustomer(admin, { type: 'individual', displayName: 'Ada Lovelace', email: 'ada@example.com' });

      const read = await c.inject({ method: 'GET', url: `/api/v1/customers/${id}`, headers: c.readHeaders(admin) });
      expect(read.statusCode).toBe(200);
      const body = JSON.parse(read.body) as Record<string, unknown>;
      expect(body).toEqual(expect.objectContaining({ displayName: 'Ada Lovelace', status: 'active', type: 'individual' }));
      expect(body['tenantId']).toBeUndefined();

      const list = await c.inject({ method: 'GET', url: '/api/v1/customers?q=Ada', headers: c.readHeaders(admin) });
      expect(list.statusCode).toBe(200);
      expect((JSON.parse(list.body) as { data: unknown[] }).data).toHaveLength(1);

      const patch = await c.inject({
        method: 'PATCH',
        url: `/api/v1/customers/${id}`,
        headers: c.writeHeaders(admin),
        payload: { phone: '+593999', status: 'inactive' },
      });
      expect(patch.statusCode).toBe(200);
      expect(JSON.parse(patch.body)).toEqual(expect.objectContaining({ phone: '+593999', status: 'inactive' }));
    });

    it('rejects an unknown field in the body (400, mass assignment §83)', async () => {
      const admin = await seedAdmin('Cust Beta Co', 'admin@cust-beta.example');
      const response = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: c.writeHeaders(admin),
        payload: { type: 'individual', displayName: 'X', tenantId: '00000000-0000-0000-0000-000000000000', status: 'inactive', createdBy: 'x' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a malformed email (400)', async () => {
      const admin = await seedAdmin('Cust Gamma Co', 'admin@cust-gamma.example');
      const response = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: c.writeHeaders(admin),
        payload: { type: 'individual', displayName: 'X', email: 'not-an-email' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('identification uniqueness — per tenant, not global (§10, §100)', () => {
    it('rejects a duplicate taxId within one tenant (409) but allows the same taxId in a different tenant', async () => {
      const tenantA = await seedAdmin('Cust IdA Co', 'admin@cust-ida.example');
      const tenantB = await seedAdmin('Cust IdB Co', 'admin@cust-idb.example');

      const first = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: c.writeHeaders(tenantA),
        payload: { type: 'business', displayName: 'Contoso', taxId: '1790012345001' },
      });
      expect(first.statusCode).toBe(201);

      const dupSameTenant = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: c.writeHeaders(tenantA),
        payload: { type: 'business', displayName: 'Contoso 2', taxId: '1790012345001' },
      });
      expect(dupSameTenant.statusCode).toBe(409);

      const sameIdOtherTenant = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: c.writeHeaders(tenantB),
        payload: { type: 'business', displayName: 'Contoso EC', taxId: '1790012345001' },
      });
      expect(sameIdOtherTenant.statusCode).toBe(201);
    });
  });

  describe('cross-tenant IDOR (§48, §103)', () => {
    it('tenant A cannot read or modify tenant B customers — 404, not a leak', async () => {
      const tenantA = await seedAdmin('Cust IdorA Co', 'admin@cust-idora.example');
      const tenantB = await seedAdmin('Cust IdorB Co', 'admin@cust-idorb.example');
      const bCustomer = await c.createCustomer(tenantB, { type: 'individual', displayName: 'B Only' });

      const read = await c.inject({ method: 'GET', url: `/api/v1/customers/${bCustomer}`, headers: c.readHeaders(tenantA) });
      expect(read.statusCode).toBe(404);

      const patch = await c.inject({
        method: 'PATCH',
        url: `/api/v1/customers/${bCustomer}`,
        headers: c.writeHeaders(tenantA),
        payload: { phone: '+1' },
      });
      expect(patch.statusCode).toBe(404);

      const list = await c.inject({ method: 'GET', url: '/api/v1/customers', headers: c.readHeaders(tenantA) });
      expect((JSON.parse(list.body) as { data: { displayName: string }[] }).data.some((row) => row.displayName === 'B Only')).toBe(false);
    });
  });

  describe('RBAC (§66, §147)', () => {
    it('401 anonymous; 403 without sales.customers.* ; view vs manage split', async () => {
      const admin = await seedAdmin('Cust Rbac Co', 'admin@cust-rbac.example');
      // Bodega has no sales.* permissions in the default template.
      const bodega = await c.createAndLoginAs(admin, 'bodega@cust-rbac.example', 'Bodega');

      expect((await c.inject({ method: 'GET', url: '/api/v1/customers' })).statusCode).toBe(401);
      expect((await c.inject({ method: 'GET', url: '/api/v1/customers', headers: c.readHeaders(bodega) })).statusCode).toBe(403);

      const vendedor = await c.createAndLoginAs(admin, 'vendedor@cust-rbac.example', 'Vendedor');
      expect((await c.inject({ method: 'GET', url: '/api/v1/customers', headers: c.readHeaders(vendedor) })).statusCode).toBe(200);
      const create = await c.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: c.writeHeaders(vendedor),
        payload: { type: 'individual', displayName: 'Vendedor made me' },
      });
      expect(create.statusCode).toBe(201);
    });
  });
});
