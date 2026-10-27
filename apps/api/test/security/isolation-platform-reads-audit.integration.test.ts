import { and, eq, gt } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { PlatformAuditLogService } from '../../src/common/audit/platform-audit-log.service';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, makePlatformClient, uniq, withDb, type PlatformSession } from './iso-helpers';

/**
 * FASE 19 — CHARACTERIZATION of the four platform READ routes named by the pending item "platform-only reads are not audited":
 * `GET /platform/tenants`, `GET /platform/tenants/:id`, `GET /platform/tenants/:id/admin-invitation`, `GET /platform/summary`.
 *
 * These are `@PlatformOnly()` control-plane routes (ADR-0032): they need a verified platform-admin token and nothing else. They never read a
 * support session (ADR-0036), so whether the admin has one — read, write, expired, on a suspended tenant — changes nothing about them. The tests
 * below PIN the status, the shape of the answer and what `audit_log` holds afterwards.
 *
 * DECISION (option B of PLATFORM-READS-NOT-AUDITED): only the two tenant-specific reads — `GET /platform/tenants/:id` and
 * `GET /platform/tenants/:id/admin-invitation` — write a `platform.read` row (opt-in `@AuditPlatformRead`, fail-closed). The list, the summary and
 * `GET /platform/support-sessions/current` (read on every SuperAdmin page for the support banner) stay unaudited by design. Authorisation is untouched.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('platform read routes under and outside support sessions — characterization (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let p: ReturnType<typeof makePlatformClient>;

  interface Tenant {
    admin: Session;
    tenantId: string;
    name: string;
  }
  let A: Tenant;
  let B: Tenant;

  async function seedTenant(label: string): Promise<Tenant> {
    const stamp = uniq();
    const name = `${label} ${stamp}`;
    const admin = await c.registerTenant(name, `iso-${label.toLowerCase().replace(/\W+/g, '-')}-${stamp}@example.com`);
    return { admin, tenantId: admin.user.tenantId, name };
  }

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
    c = makeClient(app);
    p = makePlatformClient(app);
    A = await seedTenant('Iso PRead A');
    B = await seedTenant('Iso PRead B');
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  const routes = () => [
    { name: 'GET /platform/tenants', url: '/api/v1/platform/tenants' },
    { name: 'GET /platform/tenants/:id', url: `/api/v1/platform/tenants/${A.tenantId}` },
    { name: 'GET /platform/tenants/:id/admin-invitation', url: `/api/v1/platform/tenants/${A.tenantId}/admin-invitation` },
    { name: 'GET /platform/summary', url: '/api/v1/platform/summary' },
  ];
  const read = (s: PlatformSession, url: string) => p.inject({ method: 'GET', url, headers: p.headers(s) });
  const startSession = async (s: PlatformSession, tenantId: string, mode: 'read' | 'write'): Promise<string> => {
    const res = await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/support-sessions`, headers: p.headers(s), payload: { mode, reason: 'ISO-SUP-23 platform reads' } });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  };
  const endSession = (s: PlatformSession) => p.inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: p.headers(s) });
  /** Every audit row written by this platform admin since `since` (a Date taken before the probes). */
  const rowsSince = (adminId: string, since: Date) =>
    withDb((db) => db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, adminId), gt(schema.auditLog.createdAt, since))));

  it('ISO-SUP-23 the four routes answer a platform admin the same way with no session, a read session and a write session; the two tenant-specific reads leave exactly one platform.read row each, the list and the summary leave none', async () => {
    const admin = await p.newAdmin();
    const answers: Record<string, Record<string, { status: number; shape: string }>> = {};
    const record = async (phase: string) => {
      for (const r of routes()) {
        const res = await read(admin, r.url);
        const parsed = JSON.parse(res.body) as unknown;
        // the SHAPE of the answer: the keys of an object, or the keys of the first element of a list — never the list's length, which moves when parallel files register tenants
        const keys = Array.isArray(parsed) ? Object.keys((parsed[0] as object | undefined) ?? {}) : Object.keys((parsed as object | null) ?? {});
        answers[r.name] = { ...(answers[r.name] ?? {}), [phase]: { status: res.statusCode, shape: `${Array.isArray(parsed) ? 'list' : 'object'}:${keys.sort().join(',')}` } };
      }
    };
    const since = new Date(Date.now() - 1000);

    await record('no session');
    const outside = await rowsSince(admin.admin.id, since);
    expect(outside.map((r) => (r.afterState as { route: string }).route).sort(), 'outside a session: one row for :id and one for the invitation').toEqual(['/api/v1/platform/tenants/:tenantId', '/api/v1/platform/tenants/:tenantId/admin-invitation']);
    expect(outside.every((r) => r.actionCode === 'platform.read')).toBe(true);

    await startSession(admin, A.tenantId, 'read');
    const afterStart = (await rowsSince(admin.admin.id, since)).filter((r) => r.actionCode !== 'platform.read').length; // the session's own start row only
    await record('read session');
    await endSession(admin);
    await startSession(admin, A.tenantId, 'write');
    await record('write session');
    await endSession(admin);

    for (const r of routes()) {
      const a = answers[r.name]!;
      expect(a['no session']!.status, `${r.name} no session`).toBe(200);
      expect(a['read session'], `${r.name}: a read session changes nothing`).toEqual(a['no session']);
      expect(a['write session'], `${r.name}: a write session changes nothing`).toEqual(a['no session']);
    }
    // three phases x two audited routes = six platform.read rows; everything else is the two sessions' start/end — and no support.tenant_read
    const rows = await rowsSince(admin.admin.id, since);
    expect(rows.filter((r) => r.actionCode === 'platform.read')).toHaveLength(6);
    expect(rows.map((r) => r.actionCode).filter((a) => a !== 'platform.read').sort()).toEqual(['support_session.ended', 'support_session.ended', 'support_session.started', 'support_session.started']);
    expect(rows.some((r) => r.actionCode === 'support.tenant_read')).toBe(false);
    expect(afterStart).toBe(1);
  });

  it('ISO-SUP-24 a support session does not narrow these routes: with a session on tenant A the list still answers with every tenant, and the invitation answer holds no email or token', async () => {
    const admin = await p.newAdmin();
    await startSession(admin, A.tenantId, 'read');
    const list = await read(admin, '/api/v1/platform/tenants');
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body) as Array<Record<string, unknown>>;
    expect(body.some((t) => t['id'] === A.tenantId)).toBe(true);
    expect(body.some((t) => t['id'] === B.tenantId), 'tenant B is listed although the session is on A').toBe(true);
    expect(Object.keys(body[0]!).sort(), 'the fields a tenant row exposes').toEqual(['createdAt', 'id', 'isDemo', 'name', 'slug', 'status']);

    const summaryRes = await read(admin, '/api/v1/platform/summary');
    expect(summaryRes.statusCode).toBe(200);
    // aggregates only: no individual tenant's id or name
    for (const marker of [A.tenantId, B.tenantId, A.name, B.name]) expect(summaryRes.body.includes(marker), `summary leaks ${marker.slice(0, 12)}`).toBe(false);

    const invitation = await read(admin, `/api/v1/platform/tenants/${A.tenantId}/admin-invitation`);
    expect(invitation.statusCode).toBe(200);
    if (invitation.body && invitation.body !== 'null') {
      const keys = Object.keys(JSON.parse(invitation.body) as Record<string, unknown>);
      for (const key of keys) expect(['id', 'status', 'sentAt', 'expiresAt', 'acceptedAt', 'revokedAt']).toContain(key);
      expect(invitation.body.toLowerCase()).not.toMatch(/token|email|@/);
    }
    await endSession(admin);
  });

  it('ISO-SUP-25 expired session, ended session and suspended target tenant: the routes answer exactly as before (they never consulted the session); the audited ones still add exactly their own row', async () => {
    const admin = await p.newAdmin();
    const victim = await seedTenant('Iso PRead C');
    const since = new Date(Date.now() - 1000);
    const sessionId = await startSession(admin, victim.tenantId, 'read');
    const url = `/api/v1/platform/tenants/${victim.tenantId}`;
    expect((await read(admin, url)).statusCode).toBe(200);

    // expire the session in the database (the HTTP contract cannot shorten it)
    await withDb((db) => db.update(schema.platformSupportSessions).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.platformSupportSessions.id, sessionId)));
    expectDenied(await read(admin, '/api/v1/warehouses'), [401, 403], 'ordinary tenant API with an expired session');
    for (const r of routes()) expect((await read(admin, r.url)).statusCode, `${r.name} with an expired session`).toBe(200);

    // suspended target tenant: the read-through is closed (ISO-SUP-13) but these platform routes are not
    expect((await p.inject({ method: 'POST', url: `${url}/suspend`, headers: p.headers(admin) })).statusCode).toBe(200);
    expectDenied(await read(admin, '/api/v1/warehouses'), [401, 403], 'ordinary tenant API on a suspended tenant');
    const suspended = await read(admin, url);
    expect(suspended.statusCode).toBe(200);
    expect((JSON.parse(suspended.body) as { status: string }).status).toBe('suspended');
    expect((await read(admin, `${url}/admin-invitation`)).statusCode).toBe(200);

    const rows = await rowsSince(admin.admin.id, since);
    // reads of :id / :id/admin-invitation: 1 (before expiry) + 2 (the route loop) + 2 (after the suspension) = 5 platform.read rows, never a support.tenant_read
    expect(rows.filter((r) => r.actionCode === 'platform.read')).toHaveLength(5);
    expect(rows.some((r) => r.actionCode === 'support.tenant_read')).toBe(false);
    expect(rows.map((r) => r.actionCode).filter((a) => a !== 'platform.read').sort(), 'the session start and the suspension (a write) keep their own single row').toEqual(['support_session.started', 'tenant.suspended']);
    await endSession(admin);
  });

  it('ISO-SUP-26 refusals: anonymous 401 and a tenant Administrador 401/403 on all four routes, with no audit row and no data in the refusal', async () => {
    const admin = await p.newAdmin();
    const since = new Date(Date.now() - 1000);
    for (const r of routes()) {
      const anon = await p.inject({ method: 'GET', url: r.url });
      expectDenied(anon, [401], `${r.name} anonymous`);
      const tenantAdmin = await p.inject({ method: 'GET', url: r.url, headers: c.readHeaders(A.admin) });
      expectDenied(tenantAdmin, [401, 403], `${r.name} tenant admin`);
      for (const res of [anon, tenantAdmin]) expect(res.body.includes(A.name) || res.body.includes(B.name), `${r.name}: refusal carries no tenant data`).toBe(false);
    }
    expect(await rowsSince(admin.admin.id, since)).toHaveLength(0);
    expect((await withDb((db) => db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, A.admin.user.id), eq(schema.auditLog.actionCode, 'platform.read'))))).length).toBe(0);
  });
  type Row = typeof schema.auditLog.$inferSelect;
  const readRows = (adminId: string, since: Date): Promise<Row[]> => rowsSince(adminId, since).then((rows) => rows.filter((r) => r.actionCode === 'platform.read'));
  const st = (r: Row) => r.afterState as { method: string; route: string; resource: string; outcome: string; statusCode: number; queryKeys: string[] };

  it('ISO-SUP-27 platform.read: one row per read of :id / admin-invitation — platform admin as actor, the path tenant, template route, no secrets — and NOTHING for the list, the summary or the support banner route', async () => {
    const admin = await p.newAdmin();
    const since = new Date(Date.now() - 1000);
    const detail = await read(admin, `/api/v1/platform/tenants/${A.tenantId}?probe=SECRETVALUE`);
    const invitation = await read(admin, `/api/v1/platform/tenants/${A.tenantId}/admin-invitation`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(invitation.statusCode, invitation.body).toBe(200);
    const rows = await readRows(admin.admin.id, since);
    expect(rows).toHaveLength(2);
    const d = rows.find((r) => st(r).resource === 'tenant')!;
    const i = rows.find((r) => st(r).resource === 'tenant_admin_invitation')!;
    for (const row of rows) {
      expect(row.actorType, 'the actor is the platform admin').toBe('platform_admin');
      expect(row.actorId).toBe(admin.admin.id);
      expect(row.tenantId, 'the path tenant').toBe(A.tenantId);
      expect(row.entityType).toBe('tenant');
      expect(row.entityId).toBe(A.tenantId);
      expect(row.correlationId, 'request correlation id').toBeTruthy();
      expect(st(row)).toMatchObject({ method: 'GET', outcome: 'success', statusCode: 200 });
      expect(Object.keys(st(row)).sort()).toEqual(['method', 'outcome', 'queryKeys', 'resource', 'route', 'statusCode']);
    }
    expect(st(d).route).toBe('/api/v1/platform/tenants/:tenantId');
    expect(st(d).queryKeys, 'parameter NAMES only').toEqual(['probe']);
    expect(st(i).route).toBe('/api/v1/platform/tenants/:tenantId/admin-invitation');
    const serialized = JSON.stringify(rows).toLowerCase();
    for (const forbidden of ['SECRETVALUE', admin.accessToken, admin.csrfToken, 'cookie', 'authorization', A.name]) {
      expect(serialized.includes(String(forbidden).toLowerCase()), `a row contains "${String(forbidden).slice(0, 14)}"`).toBe(false);
    }

    // the excluded routes — including the banner route read on every SuperAdmin page — write no platform.read row, with or without a session
    await startSession(admin, A.tenantId, 'read');
    for (let n = 0; n < 5; n += 1) expect((await read(admin, '/api/v1/platform/support-sessions/current')).statusCode).toBe(200);
    expect((await read(admin, '/api/v1/platform/tenants')).statusCode).toBe(200);
    expect((await read(admin, '/api/v1/platform/summary')).statusCode).toBe(200);
    expect(await readRows(admin.admin.id, since), 'still only the two rows').toHaveLength(2);
    // a support session on A does not make a read of B any different: the platform route is attributed to B, the support audit is untouched
    expect((await read(admin, `/api/v1/platform/tenants/${B.tenantId}`)).statusCode).toBe(200);
    const after = await rowsSince(admin.admin.id, since);
    expect(after.filter((r) => r.actionCode === 'platform.read' && r.tenantId === B.tenantId)).toHaveLength(1);
    expect(after.some((r) => r.actionCode === 'support.tenant_read'), 'support.tenant_read is not produced by platform routes').toBe(false);
    await endSession(admin);
  });

  it('ISO-SUP-27b the existing write events are neither changed nor duplicated, and unknown / malformed ids keep their HTTP answers', async () => {
    const admin = await p.newAdmin();
    const victim = await seedTenant('Iso PRead D');
    const since = new Date(Date.now() - 1000);
    const nil = '00000000-0000-4000-8000-000000000000';

    // HTTP answers unchanged: unknown tenant -> 404 on the detail, 200 on the invitation; malformed -> 400
    expectDenied(await read(admin, `/api/v1/platform/tenants/${nil}`), [404], 'unknown tenant');
    expect((await read(admin, `/api/v1/platform/tenants/${nil}/admin-invitation`)).statusCode).toBe(200);
    expectDenied(await read(admin, '/api/v1/platform/tenants/not-a-uuid'), [400], 'malformed id');
    expectDenied(await read(admin, '/api/v1/platform/tenants/not-a-uuid/admin-invitation'), [400], 'malformed id (invitation)');

    // an unknown uuid is recorded with NO tenant (the foreign key is never asked to hold it); a malformed id is not audited (nothing was read)
    const unknownRows = (await readRows(admin.admin.id, since)).filter((r) => r.entityId === nil);
    expect(unknownRows.map((r) => [st(r).resource, st(r).outcome, st(r).statusCode, r.tenantId])).toEqual([
      ['tenant', 'not_found', 404, null],
      ['tenant_admin_invitation', 'success', 200, null],
    ]);
    expect(await readRows(admin.admin.id, since), 'malformed ids add nothing').toHaveLength(2);

    // writes: one row each, as before, and no platform.read for a POST
    const mark = new Date(Date.now() - 1000);
    expect((await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${victim.tenantId}/suspend`, headers: p.headers(admin) })).statusCode).toBe(200);
    expect((await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${victim.tenantId}/activate`, headers: p.headers(admin) })).statusCode).toBe(200);
    await startSession(admin, victim.tenantId, 'read');
    await endSession(admin);
    const rows = await rowsSince(admin.admin.id, mark);
    expect(rows.map((r) => r.actionCode).filter((c) => c !== 'platform.read').sort(), 'each write keeps its own single row').toEqual(['support_session.ended', 'support_session.started', 'tenant.activated', 'tenant.suspended']);
    // the POSTs added no platform.read: the two rows of the reads above are the only ones
    expect(await readRows(admin.admin.id, since)).toHaveLength(2);
  });

  it('ISO-SUP-28 FAIL-CLOSED over HTTP: when the platform.read row cannot be written the detail and the invitation are NOT delivered (500, one attempt, no data, no cause), the unaudited routes are unaffected, and reads resume afterwards', async () => {
    const admin = await p.newAdmin();
    const since = new Date(Date.now() - 1000);
    const original = PlatformAuditLogService.prototype.record;
    const spy = vi.spyOn(PlatformAuditLogService.prototype, 'record').mockImplementation(function (this: PlatformAuditLogService, entry) {
      if (entry.actionCode === 'platform.read') return Promise.reject(new Error('simulated audit outage'));
      return original.call(this, entry);
    });
    try {
      for (const url of [`/api/v1/platform/tenants/${A.tenantId}`, `/api/v1/platform/tenants/${A.tenantId}/admin-invitation`]) {
        const before = spy.mock.calls.filter(([e]) => e.actionCode === 'platform.read').length;
        const res = await read(admin, url);
        expect(res.statusCode, `${url}: refused while the audit is down`).toBe(500);
        expect(res.body.includes(A.name) || res.body.includes(A.tenantId), `${url}: no tenant data in the error`).toBe(false);
        expect(res.body.toLowerCase().includes('simulated audit outage'), `${url}: the cause is not echoed`).toBe(false);
        expect(spy.mock.calls.filter(([e]) => e.actionCode === 'platform.read').length - before, `${url}: exactly one attempt`).toBe(1);
      }
      expect(await readRows(admin.admin.id, since), 'nothing recorded while the audit is down').toHaveLength(0);
      // the routes left unaudited by decision are not affected by the outage
      for (const url of ['/api/v1/platform/tenants', '/api/v1/platform/summary', '/api/v1/platform/support-sessions/current']) expect((await read(admin, url)).statusCode, url).toBe(200);
    } finally {
      spy.mockRestore();
    }
    const ok = await read(admin, `/api/v1/platform/tenants/${A.tenantId}`);
    expect(ok.statusCode, ok.body.slice(0, 200)).toBe(200);
    expect(await readRows(admin.admin.id, since)).toHaveLength(1);
  });

});
