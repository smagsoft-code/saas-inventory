import { and, asc, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, makePlatformClient, uniq, withDb, type PlatformSession } from './iso-helpers';

const READ = 'support.tenant_read';

/**
 * FASE 19 — `SUP-READ-NOT-AUDITED`. ADR-0036's read-through lets a platform admin with an active support session `GET` the ordinary
 * tenant API (and the curated `support/*` reads). Until now only `support_session.started/ended` and the one curated write were
 * audited: WHAT support read left no trace. Contract under test: every `GET` served under a support session leaves exactly one
 * `audit_log` row `support.tenant_read` — actor = the PLATFORM admin (never a tenant user), tenant = the session's tenant,
 * entity = the support session — carrying only the method, route template, outcome, status, query KEY names and the resource id; never
 * query values, tokens, cookies, bodies or response payloads. Reads outside a support session are unaffected.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('support read-through audit (integration, FASE 19, SUP-READ-NOT-AUDITED)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let p: ReturnType<typeof makePlatformClient>;

  interface Tenant {
    admin: Session;
    tenantId: string;
    warehouseId: string;
  }
  let A: Tenant;
  let B: Tenant;

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    p = makePlatformClient(app);
    A = await seedTenant('Iso Aud A');
    B = await seedTenant('Iso Aud B');
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  async function seedTenant(label: string): Promise<Tenant> {
    const stamp = uniq();
    const admin = await c.registerTenant(`${label} ${stamp}`, `iso-${label.toLowerCase().replace(/\W+/g, '-')}-${stamp}@example.com`);
    const warehouseId = await c.createWarehouse(admin, `ISO-${stamp.toUpperCase().replace(/[^A-Z0-9]/g, '')}`);
    return { admin, tenantId: admin.user.tenantId, warehouseId };
  }

  const start = async (s: PlatformSession, tenantId: string, mode: 'read' | 'write'): Promise<string> => {
    const res = await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/support-sessions`, headers: p.headers(s), payload: { mode, reason: 'ISO-SUP-15 audit probe' } });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  };
  const end = (s: PlatformSession) => p.inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: p.headers(s) });
  const read = (s: PlatformSession, url: string, extra: Record<string, string> = {}) => p.inject({ method: 'GET', url, headers: { ...p.headers(s), ...extra } });

  type AuditRow = typeof schema.auditLog.$inferSelect;
  const readRows = (adminId: string): Promise<AuditRow[]> =>
    withDb((db) => db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, adminId), eq(schema.auditLog.actionCode, READ))).orderBy(asc(schema.auditLog.createdAt)));
  const state = (row: AuditRow) => row.afterState as { method: string; route: string; outcome: string; statusCode: number; mode: string; queryKeys?: string[]; resourceId?: string };

  it('ISO-SUP-15 every read-through GET leaves ONE audit row naming the platform admin, the session tenant and session, the route template and the outcome — repeated and paginated reads included', async () => {
    const admin = await p.newAdmin();
    const sessionId = await start(admin, A.tenantId, 'read');
    expect(await readRows(admin.admin.id)).toHaveLength(0); // starting the session is not a read

    expect((await read(admin, '/api/v1/warehouses')).statusCode).toBe(200);
    expect((await read(admin, '/api/v1/warehouses')).statusCode).toBe(200); // repeated: two rows, not one
    expect((await read(admin, `/api/v1/warehouses/${A.warehouseId}`)).statusCode).toBe(200);
    expect((await read(admin, '/api/v1/customers?page=1&pageSize=5')).statusCode).toBe(200);
    expect((await read(admin, '/api/v1/customers?page=2&pageSize=5')).statusCode).toBe(200); // pagination: a row per page

    const rows = await readRows(admin.admin.id);
    expect(rows.map((r) => state(r).route)).toEqual([
      '/api/v1/warehouses',
      '/api/v1/warehouses',
      '/api/v1/warehouses/:id',
      '/api/v1/customers',
      '/api/v1/customers',
    ]);
    for (const row of rows) {
      expect(row.actorType, 'the actor is the platform admin, never a tenant user').toBe('platform_admin');
      expect(row.tenantId).toBe(A.tenantId);
      expect(row.entityType).toBe('support_session');
      expect(row.entityId).toBe(sessionId);
      expect(state(row)).toMatchObject({ method: 'GET', outcome: 'success', statusCode: 200, mode: 'read' });
      expect(row.correlationId, 'request correlation id').toBeTruthy();
    }
    expect(state(rows[2]!).resourceId).toBe(A.warehouseId);
    expect(state(rows[3]!).queryKeys).toEqual(['page', 'pageSize']);
    // nothing landed under tenant B
    const bRows = await withDb((db) => db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, B.tenantId), eq(schema.auditLog.actionCode, READ))));
    expect(bRows).toHaveLength(0);
    await end(admin);
  });

  it('ISO-SUP-16 failed reads are audited with their outcome (not found, bad input); denied or session-less requests touch no data and write no read row', async () => {
    const admin = await p.newAdmin();
    // no session yet: the ordinary tenant API is closed, nothing is read, nothing is audited
    expectDenied(await read(admin, '/api/v1/warehouses'), [401, 403], 'no session');
    expect(await readRows(admin.admin.id)).toHaveLength(0);

    await start(admin, A.tenantId, 'read');
    expectDenied(await read(admin, `/api/v1/warehouses/${B.warehouseId}`), [404], 'foreign warehouse by id');
    expectDenied(await read(admin, '/api/v1/warehouses/not-a-uuid'), [400], 'malformed id');
    // a write-verb attempt is refused before any read happens and is not a read row
    expectDenied(await p.inject({ method: 'POST', url: '/api/v1/warehouses', headers: p.headers(admin), payload: { name: 'x', code: 'X' } }), [403], 'write under read-through');

    const rows = await readRows(admin.admin.id);
    expect(rows.map((r) => [state(r).route, state(r).outcome, state(r).statusCode])).toEqual([
      ['/api/v1/warehouses/:id', 'not_found', 404],
      ['/api/v1/warehouses/:id', 'rejected', 400],
    ]);
    // the foreign id is recorded as the id the caller ASKED for, under the session tenant — it is not data of B
    expect(rows.every((r) => r.tenantId === A.tenantId)).toBe(true);

    // after the session ends the API is closed again and nothing more is written
    await end(admin);
    expectDenied(await read(admin, '/api/v1/warehouses'), [401, 403], 'after the session');
    expect(await readRows(admin.admin.id)).toHaveLength(2);
  });

  it('ISO-SUP-17 the curated support reads (users, warehouses) are audited too; the session start/end rows and the curated write keep their own single row', async () => {
    const admin = await p.newAdmin();
    const sessionId = await start(admin, A.tenantId, 'write');
    expect((await read(admin, `/api/v1/platform/tenants/${A.tenantId}/support/users`)).statusCode).toBe(200);
    expect((await read(admin, `/api/v1/platform/tenants/${A.tenantId}/support/warehouses`)).statusCode).toBe(200);
    // cross-tenant steering on the curated route: another tenant's id has no session → refused, no read row for B
    expectDenied(await read(admin, `/api/v1/platform/tenants/${B.tenantId}/support/users`), [403], 'support read on a tenant without a session');
    const patch = await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses/${A.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'inactive' } });
    expect(patch.statusCode, patch.body).toBe(200);
    await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses/${A.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'active' } });

    const rows = await readRows(admin.admin.id);
    expect(rows.map((r) => state(r).route)).toEqual(['/api/v1/platform/tenants/:tenantId/support/users', '/api/v1/platform/tenants/:tenantId/support/warehouses']);
    expect(rows.every((r) => r.tenantId === A.tenantId && r.entityId === sessionId)).toBe(true);
    const all = await withDb((db) => db.select().from(schema.auditLog).where(eq(schema.auditLog.actorId, admin.admin.id)));
    const count = (code: string) => all.filter((r) => r.actionCode === code).length;
    expect(count('support_session.started')).toBe(1);
    expect(count('support.warehouse_status_changed'), 'the curated write is audited once, not twice').toBe(2);
    expect(all.filter((r) => r.afterState && (state(r).method === 'PATCH')).length, 'no read row for a write').toBe(0);
    await end(admin);
  });

  it('ISO-SUP-18 the audit row carries no query values, tokens, cookies or response data', async () => {
    const admin = await p.newAdmin();
    await start(admin, A.tenantId, 'read');
    const secretQuery = `SECRETQ${uniq().replace(/[^a-z0-9]/gi, '')}`;
    const res = await read(admin, `/api/v1/customers?q=${secretQuery}&page=1&pageSize=5`, { 'x-test-trace': 'trace-header-value' });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await readRows(admin.admin.id);
    expect(rows).toHaveLength(1);
    const serialized = JSON.stringify(rows[0]);
    expect(state(rows[0]!).queryKeys!.sort()).toEqual(['page', 'pageSize', 'q']);
    for (const forbidden of [secretQuery, 'trace-header-value', admin.accessToken, admin.csrfToken, 'cookie', 'authorization', A.admin.user.id]) {
      expect(serialized.toLowerCase().includes(String(forbidden).toLowerCase()), `audit row contains "${String(forbidden).slice(0, 20)}"`).toBe(false);
    }
    expect(Object.keys(state(rows[0]!)).sort()).toEqual(['method', 'mode', 'outcome', 'queryKeys', 'route', 'statusCode']);
    await end(admin);
  });

  it('ISO-SUP-19 ordinary tenant reads and platform-only reads are unaffected: no read row for a tenant admin, none for platform routes outside a support session', async () => {
    const admin = await p.newAdmin();
    expect((await c.inject({ method: 'GET', url: '/api/v1/warehouses', headers: c.readHeaders(A.admin) })).statusCode).toBe(200);
    expect((await read(admin, '/api/v1/platform/tenants')).statusCode).toBe(200);
    expect((await read(admin, '/api/v1/platform/summary')).statusCode).toBe(200);
    const after = await withDb((db) => db.select().from(schema.auditLog).where(eq(schema.auditLog.actionCode, READ)));
    // other files may run support sessions in the same database: compare by actor, never by global count
    expect(after.filter((r) => r.actorId === admin.admin.id)).toHaveLength(0);
    expect(after.filter((r) => r.actorId === A.admin.user.id)).toHaveLength(0);
  });
});
