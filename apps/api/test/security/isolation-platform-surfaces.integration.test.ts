import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, expectNoLeak, makePlatformClient, uniq, withDb, type PlatformSession } from './iso-helpers';

/**
 * GAP-F19-RLS-IDOR-DEPTH — HTTP tenant-isolation sweep, PLATFORM surfaces: SuperAdmin support sessions
 * (ADR-0036) and tenant onboarding / invitations / revocation. Real `buildApp()`, real PostgreSQL, two
 * (or more) isolated tenants. Each case states the expected contract; a mismatch is a finding.
 *
 * Case ids (ISO-SUP-nn / ISO-ONB-nn) are what docs/security/tenant-isolation-http-matrix.md refers to.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('tenant isolation over HTTP — platform surfaces (support sessions, onboarding, invitations)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;
  let p: ReturnType<typeof makePlatformClient>;

  interface Tenant {
    admin: Session;
    tenantId: string;
    email: string;
    warehouseId: string;
    warehouseName: string;
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
    A = await seedTenant('Iso Plat A');
    B = await seedTenant('Iso Plat B');
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  async function seedTenant(label: string): Promise<Tenant> {
    const stamp = uniq();
    const email = `iso-${label.toLowerCase().replace(/\W+/g, '-')}-${stamp}@example.com`;
    const admin = await c.registerTenant(`${label} ${stamp}`, email);
    const code = `ISO-${stamp.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
    const warehouseId = await c.createWarehouse(admin, code);
    return { admin, tenantId: admin.user.tenantId, email, warehouseId, warehouseName: `WH ${code}` };
  }

  const start = (s: PlatformSession, tenantId: string, mode: 'read' | 'write', reason = 'isolation sweep') =>
    p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/support-sessions`, headers: p.headers(s), payload: { mode, reason } });

  const warehouseStatus = (id: string) =>
    withDb(async (db) => (await db.select({ s: schema.warehouses.status }).from(schema.warehouses).where(eq(schema.warehouses.id, id)))[0]?.s);

  const supportAuditCount = (tenantId: string, actionCode: string) =>
    withDb(async (db) => (await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.actionCode, actionCode)))).length);

  const sessionCount = (tenantId: string) =>
    withDb(async (db) => (await db.select().from(schema.platformSupportSessions).where(eq(schema.platformSupportSessions.tenantId, tenantId))).length);

  /** Every support-related route, for one target tenant + warehouse. */
  const supportRoutes = (tenantId: string, warehouseId: string) => [
    { method: 'POST' as const, url: `/api/v1/platform/tenants/${tenantId}/support-sessions`, payload: { mode: 'read', reason: 'x' } },
    { method: 'POST' as const, url: '/api/v1/platform/support-sessions/current/end' },
    { method: 'GET' as const, url: '/api/v1/platform/support-sessions/current' },
    { method: 'GET' as const, url: `/api/v1/platform/tenants/${tenantId}/support/users` },
    { method: 'GET' as const, url: `/api/v1/platform/tenants/${tenantId}/support/warehouses` },
    { method: 'PATCH' as const, url: `/api/v1/platform/tenants/${tenantId}/support/warehouses/${warehouseId}/status`, payload: { status: 'inactive' } },
  ];

  // ------------------------------------------------------------------------------------------------
  // SUPPORT SESSIONS
  // ------------------------------------------------------------------------------------------------
  describe('SuperAdmin support sessions', () => {
    it('ISO-SUP-01 anonymous: every support route is 401 and nothing is created or changed', async () => {
      const before = await sessionCount(A.tenantId);
      for (const r of supportRoutes(A.tenantId, A.warehouseId)) {
        const res = await p.inject({ method: r.method, url: r.url, ...('payload' in r ? { payload: r.payload } : {}) });
        expectDenied(res, [401], `anonymous ${r.method} ${r.url}`);
      }
      expect(await sessionCount(A.tenantId)).toBe(before);
      expect(await warehouseStatus(A.warehouseId)).toBe('active');
    });

    it('ISO-SUP-02 a full-access TENANT Administrador is 401/403 on every support route, even targeting its OWN tenant', async () => {
      const before = await sessionCount(A.tenantId);
      for (const r of supportRoutes(A.tenantId, A.warehouseId)) {
        const res = await p.inject({ method: r.method, url: r.url, headers: c.writeHeaders(A.admin), ...('payload' in r ? { payload: r.payload } : {}) });
        expectDenied(res, [401, 403], `tenant admin ${r.method} ${r.url}`);
      }
      expect(await sessionCount(A.tenantId)).toBe(before);
      expect(await warehouseStatus(A.warehouseId)).toBe('active');
    });

    it('ISO-SUP-03 token confusion: a tenant JWT under the platform cookie name, and a platform JWT under the tenant cookie name, are both 401', async () => {
      const admin = await p.newAdmin();
      // tenant access token presented as a platform session
      const tenantAsPlatform = await p.inject({
        method: 'GET',
        url: '/api/v1/platform/support-sessions/current',
        headers: { cookie: `platform_access_token=${A.admin.accessToken}; platform_csrf_token=${A.admin.csrfToken}`, 'x-csrf-token': A.admin.csrfToken },
      });
      expectDenied(tenantAsPlatform, [401, 403], 'tenant JWT as platform session');
      // platform access token presented as a tenant session
      const platformAsTenant = await p.inject({
        method: 'GET',
        url: '/api/v1/warehouses',
        headers: { cookie: `access_token=${admin.accessToken}; csrf_token=${admin.csrfToken}`, 'x-csrf-token': admin.csrfToken },
      });
      expectDenied(platformAsTenant, [401, 403], 'platform JWT as tenant session');
    });

    it('ISO-SUP-04 a platform admin WITHOUT a support session gets 403 on the data routes and changes nothing', async () => {
      const admin = await p.newAdmin();
      for (const r of supportRoutes(A.tenantId, A.warehouseId).filter((x) => x.url.includes('/support/'))) {
        const res = await p.inject({ method: r.method, url: r.url, headers: p.headers(admin), ...('payload' in r ? { payload: r.payload } : {}) });
        expectDenied(res, [403], `no session ${r.method} ${r.url}`);
      }
      expect(await warehouseStatus(A.warehouseId)).toBe('active');
    });

    it('ISO-SUP-05 a READ session on A reads A, is refused for B, and cannot write anywhere (no change in A or B)', async () => {
      const admin = await p.newAdmin();
      expect((await start(admin, A.tenantId, 'read')).statusCode).toBe(201);

      const users = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${A.tenantId}/support/users`, headers: p.headers(admin) });
      expect(users.statusCode, users.body).toBe(200);
      expect(users.body).toContain(A.email);
      expectNoLeak(users.body, [B.email, B.tenantId, B.admin.user.id], 'A support users');
      expect(users.body).not.toMatch(/password|hash|token/i);

      const whA = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses`, headers: p.headers(admin) });
      expect(whA.statusCode).toBe(200);
      expectNoLeak(whA.body, [B.warehouseId, B.warehouseName, B.tenantId], 'A support warehouses');

      for (const path of ['users', 'warehouses']) {
        const cross = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${B.tenantId}/support/${path}`, headers: p.headers(admin) });
        expectDenied(cross, [403], `read session on A reading B ${path}`);
        expectNoLeak(cross.body, [B.email, B.warehouseName], `cross ${path}`);
      }

      // READ mode cannot write — not in A, not in B.
      const writeA = await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses/${A.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'inactive' } });
      expectDenied(writeA, [403], 'read session writing A');
      const writeB = await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${B.tenantId}/support/warehouses/${B.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'inactive' } });
      expectDenied(writeB, [403], 'read session writing B');
      expect(await warehouseStatus(A.warehouseId)).toBe('active');
      expect(await warehouseStatus(B.warehouseId)).toBe('active');
    });

    it('ISO-SUP-06 a WRITE session on A: cross-resource and cross-tenant writes are refused with NO side effect; the legitimate write is audited with session + reason', async () => {
      const admin = await p.newAdmin();
      const started = await start(admin, A.tenantId, 'write', 'ISO-SUP-06 reason marker');
      expect(started.statusCode, started.body).toBe(201);
      const sessionId = (JSON.parse(started.body) as { id: string }).id;
      const bAuditBefore = await supportAuditCount(B.tenantId, 'support.warehouse_status_changed');
      const aAuditBefore = await supportAuditCount(A.tenantId, 'support.warehouse_status_changed');

      // (1) A's session, A's URL, but B's warehouse id (IDOR on the resource id).
      const idor = await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses/${B.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'inactive' } });
      expectDenied(idor, [403, 404], 'IDOR: A session + B warehouse id');
      // (2) A's session aimed at B's URL.
      const cross = await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${B.tenantId}/support/warehouses/${B.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'inactive' } });
      expectDenied(cross, [403], 'A session writing B URL');
      // (3) mass assignment: extra fields must be rejected, not applied.
      const mass = await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses/${A.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'inactive', tenantId: B.tenantId, name: 'HACKED' } });
      expectDenied(mass, [400], 'mass assignment on support write');

      expect(await warehouseStatus(B.warehouseId)).toBe('active');
      expect(await warehouseStatus(A.warehouseId)).toBe('active');
      expect(await supportAuditCount(B.tenantId, 'support.warehouse_status_changed')).toBe(bAuditBefore);
      expect(await supportAuditCount(A.tenantId, 'support.warehouse_status_changed')).toBe(aAuditBefore);

      // The one legitimate write.
      const ok = await p.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses/${A.warehouseId}/status`, headers: p.headers(admin), payload: { status: 'inactive' } });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await warehouseStatus(A.warehouseId)).toBe('inactive');
      expect(await warehouseStatus(B.warehouseId)).toBe('active');

      await withDb(async (db) => {
        const rows = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, A.warehouseId), eq(schema.auditLog.actionCode, 'support.warehouse_status_changed')));
        const entry = rows[rows.length - 1];
        expect(entry, 'support write must be audited').toBeDefined();
        expect(entry?.actorType).toBe('platform_admin');
        expect(entry?.actorId).toBe(admin.admin.id);
        expect(entry?.tenantId).toBe(A.tenantId);
        expect(entry?.afterState).toEqual(expect.objectContaining({ status: 'inactive', supportSessionId: sessionId, reason: 'ISO-SUP-06 reason marker' }));
      });

      // restore for the other tests
      await withDb((db) => db.update(schema.warehouses).set({ status: 'active' }).where(eq(schema.warehouses.id, A.warehouseId)));
    });

    it('ISO-SUP-07 a session is bound to ITS admin and ITS tenant: another admin cannot borrow it (header/query/body), and a new session elsewhere supersedes it', async () => {
      const admin1 = await p.newAdmin();
      const admin2 = await p.newAdmin();
      const s1 = await start(admin1, A.tenantId, 'write');
      const sessionId = (JSON.parse(s1.body) as { id: string }).id;

      const borrowed = await p.inject({
        method: 'GET',
        url: `/api/v1/platform/tenants/${A.tenantId}/support/users?supportSessionId=${sessionId}&sessionId=${sessionId}`,
        headers: { ...p.headers(admin2), 'x-support-session-id': sessionId, 'x-support-session': sessionId },
      });
      expectDenied(borrowed, [400, 403], 'admin2 borrowing admin1 session');
      const borrowedWrite = await p.inject({
        method: 'PATCH',
        url: `/api/v1/platform/tenants/${A.tenantId}/support/warehouses/${A.warehouseId}/status`,
        headers: { ...p.headers(admin2), 'x-support-session-id': sessionId },
        payload: { status: 'inactive' },
      });
      expectDenied(borrowedWrite, [400, 403], 'admin2 borrowing admin1 session for a write');
      expect(await warehouseStatus(A.warehouseId)).toBe('active');

      // admin1 moves to B → the A session is superseded; A's routes are refused again for admin1.
      expect((await start(admin1, B.tenantId, 'read')).statusCode).toBe(201);
      const stale = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${A.tenantId}/support/users`, headers: p.headers(admin1) });
      expectDenied(stale, [403], 'superseded session on A');
      const nowB = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${B.tenantId}/support/users`, headers: p.headers(admin1) });
      expect(nowB.statusCode).toBe(200);
    });

    it('ISO-SUP-08 an ENDED session no longer works; ending is idempotent-safe and never ends someone else\'s session', async () => {
      const admin1 = await p.newAdmin();
      const admin2 = await p.newAdmin();
      await start(admin1, A.tenantId, 'read');
      await start(admin2, B.tenantId, 'read');
      // admin2 ends "current" — it must be THEIR session (B), not admin1's (A).
      const ended = await p.inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: p.headers(admin2) });
      expect(ended.statusCode, ended.body).toBe(200);
      expect(JSON.parse(ended.body).tenantId).toBe(B.tenantId);
      const adminOneStill = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${A.tenantId}/support/users`, headers: p.headers(admin1) });
      expect(adminOneStill.statusCode).toBe(200);
      const adminTwoDead = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${B.tenantId}/support/users`, headers: p.headers(admin2) });
      expectDenied(adminTwoDead, [403], 'ended session');
    });

    it('ISO-SUP-09 starting a session validates its input: unknown tenant 404, malformed id 400, bad mode / missing reason / extra tenantId 400', async () => {
      const admin = await p.newAdmin();
      const nil = '00000000-0000-0000-0000-000000000000';
      expectDenied(await start(admin, nil, 'read'), [404], 'unknown tenant');
      expectDenied(await p.inject({ method: 'POST', url: '/api/v1/platform/tenants/not-a-uuid/support-sessions', headers: p.headers(admin), payload: { mode: 'read', reason: 'x' } }), [400], 'malformed tenant id');
      for (const payload of [{ mode: 'admin', reason: 'x' }, { mode: 'read' }, { mode: 'read', reason: '' }, { mode: 'read', reason: 'x', tenantId: B.tenantId }]) {
        expectDenied(await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${A.tenantId}/support-sessions`, headers: p.headers(admin), payload }), [400], `bad payload ${JSON.stringify(payload)}`);
      }
    });

    it('ISO-SUP-10 ADR-0036 read-through: GET-only and bound to the session tenant — foreign ids and tenant steering get nothing of B, no tenant cookie is issued, no session = no access', async () => {
      const admin = await p.newAdmin();
      // No session → the ordinary tenant API is closed to a platform admin.
      expectDenied(await p.inject({ method: 'GET', url: '/api/v1/warehouses', headers: p.headers(admin) }), [401, 403], 'platform cookies, no session');

      const started = await start(admin, A.tenantId, 'write'); // even a WRITE session is GET-only on ordinary routes
      expect(started.statusCode, started.body).toBe(201);
      expect(p.cookieValue(started, 'access_token')).toBeUndefined();
      expect(started.body).not.toMatch(/access_token|accessToken|jwt/i);

      const list = await p.inject({ method: 'GET', url: '/api/v1/warehouses', headers: p.headers(admin) });
      expect(list.statusCode, list.body).toBe(200); // documented read-through
      expect(list.body).toContain(A.warehouseId);
      expectNoLeak(list.body, [B.warehouseId, B.warehouseName, B.tenantId], 'read-through list');

      // The tenant is fixed by the session: URL / query / header steering is ignored.
      for (const [label, url, extra] of [
        ['query tenantId', '/api/v1/warehouses?tenantId=' + B.tenantId, {}],
        ['query tenantSlug', '/api/v1/warehouses?tenantSlug=anything', {}],
        ['header x-tenant-id', '/api/v1/warehouses', { 'x-tenant-id': B.tenantId }],
        ['header x-tenant-slug', '/api/v1/warehouses', { 'x-tenant-slug': 'iso-plat-b' }],
      ] as const) {
        const res = await p.inject({ method: 'GET', url, headers: { ...p.headers(admin), ...extra } });
        expect([200, 400], label + ' -> ' + res.body.slice(0, 120)).toContain(res.statusCode);
        expectNoLeak(res.body, [B.warehouseId, B.warehouseName, B.tenantId], 'read-through ' + label);
      }
      // Foreign resources by id are simply not found.
      expectDenied(await p.inject({ method: 'GET', url: '/api/v1/warehouses/' + B.warehouseId, headers: p.headers(admin) }), [404], 'read-through reading B warehouse');
      expectDenied(await p.inject({ method: 'GET', url: '/api/v1/users/' + B.admin.user.id, headers: p.headers(admin) }), [404], 'read-through reading B user');
      const aWarehouse = await p.inject({ method: 'GET', url: '/api/v1/warehouses/' + A.warehouseId, headers: p.headers(admin) });
      expect(aWarehouse.statusCode).toBe(200);
    });

    it('ISO-SUP-12 read-through is READ-ONLY for every verb on ordinary routes — creates, updates, deletes, role, user and stock changes are all refused with NO side effect', async () => {
      const admin = await p.newAdmin();
      expect((await start(admin, A.tenantId, 'write')).statusCode).toBe(201);
      const counts = async () =>
        withDb(async (db) => ({
          warehouses: (await db.select().from(schema.warehouses).where(eq(schema.warehouses.tenantId, A.tenantId))).length,
          roles: (await db.select().from(schema.roles).where(eq(schema.roles.tenantId, A.tenantId))).length,
          customers: (await db.select().from(schema.customers).where(eq(schema.customers.tenantId, A.tenantId))).length,
          users: (await db.select().from(schema.users).where(eq(schema.users.tenantId, A.tenantId))).length,
          movements: (await db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.tenantId, A.tenantId))).length,
          warehouseName: (await db.select({ n: schema.warehouses.name }).from(schema.warehouses).where(eq(schema.warehouses.id, A.warehouseId)))[0]?.n,
        }));
      const before = await counts();
      const nil = '00000000-0000-0000-0000-000000000000';
      const stamp = uniq().replace(/[^A-Za-z0-9]/g, '');
      const writes = [
        { method: 'POST' as const, url: '/api/v1/warehouses', payload: { name: 'HACK WH', code: 'HACK-' + stamp.toUpperCase() } },
        { method: 'PATCH' as const, url: '/api/v1/warehouses/' + A.warehouseId, payload: { name: 'HACKED' } },
        { method: 'POST' as const, url: '/api/v1/roles', payload: { name: 'Hack Role', permissionCodes: [] } },
        { method: 'DELETE' as const, url: '/api/v1/roles/' + nil },
        { method: 'POST' as const, url: '/api/v1/users', payload: { email: 'hack-' + stamp + '@example.com', fullName: 'Hack', password: 'a-very-long-password', roleId: nil } },
        { method: 'PUT' as const, url: '/api/v1/users/' + A.admin.user.id + '/locations', payload: { locationIds: [] } },
        { method: 'POST' as const, url: '/api/v1/customers', payload: { type: 'pasaporte', firstName: 'Hack', lastName: 'Customer', taxId: 'HK' + stamp } },
        { method: 'POST' as const, url: '/api/v1/inventory/adjustments', payload: { productVariantId: nil, locationId: nil, movementType: 'ADJUSTMENT_OUT', quantity: 1, reason: 'x' } },
        { method: 'POST' as const, url: '/api/v1/orders/' + nil + '/cancel' },
        { method: 'PATCH' as const, url: '/api/v1/administration/tenant-settings', payload: { timezone: 'UTC' } },
      ];
      for (const w of writes) {
        const res = await p.inject({ method: w.method, url: w.url, headers: p.headers(admin), ...('payload' in w ? { payload: w.payload } : {}) });
        expectDenied(res, [403], 'read-through write ' + w.method + ' ' + w.url);
      }
      expect(await counts()).toEqual(before);
    });

    it('ISO-SUP-13 read-through ends with the session and does not apply to a suspended tenant', async () => {
      const admin = await p.newAdmin();
      const victim = await seedTenant('Iso Plat C');
      expect((await start(admin, victim.tenantId, 'read')).statusCode).toBe(201);
      expect((await p.inject({ method: 'GET', url: '/api/v1/warehouses', headers: p.headers(admin) })).statusCode).toBe(200);

      // suspended tenant → no read-through
      expect((await p.inject({ method: 'POST', url: '/api/v1/platform/tenants/' + victim.tenantId + '/suspend', headers: p.headers(admin) })).statusCode).toBe(200);
      expectDenied(await p.inject({ method: 'GET', url: '/api/v1/warehouses', headers: p.headers(admin) }), [401, 403], 'read-through on a suspended tenant');
      expect((await p.inject({ method: 'POST', url: '/api/v1/platform/tenants/' + victim.tenantId + '/activate', headers: p.headers(admin) })).statusCode).toBe(200);
      expect((await p.inject({ method: 'GET', url: '/api/v1/warehouses', headers: p.headers(admin) })).statusCode).toBe(200);

      // ended session → no read-through
      expect((await p.inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: p.headers(admin) })).statusCode).toBe(200);
      expectDenied(await p.inject({ method: 'GET', url: '/api/v1/warehouses', headers: p.headers(admin) }), [401, 403], 'read-through after the session ended');
    });

    it('ISO-SUP-14 CHARACTERIZATION (known accountability gap): read-through GETs are NOT individually audited — only session start/end are', async () => {
      const admin = await p.newAdmin();
      const started = await start(admin, A.tenantId, 'read', 'ISO-SUP-14');
      const sessionId = (JSON.parse(started.body) as { id: string }).id;
      const countFor = () => withDb(async (db) => (await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, admin.admin.id), eq(schema.auditLog.tenantId, A.tenantId)))).length);
      const before = await countFor();
      for (const url of ['/api/v1/warehouses', '/api/v1/users', '/api/v1/customers', '/api/v1/orders']) {
        await p.inject({ method: 'GET', url, headers: p.headers(admin) });
      }
      // Documented current behaviour: reads leave no per-request trail beyond the session's own start/end rows.
      expect(await countFor(), 'session ' + sessionId + ': tenant reads under support are not audited').toBe(before);
    });

    it('ISO-SUP-11 session start/end audit rows belong to the target tenant and name the platform admin', async () => {
      const admin = await p.newAdmin();
      const started = await start(admin, A.tenantId, 'read', 'ISO-SUP-11');
      const sessionId = (JSON.parse(started.body) as { id: string }).id;
      await p.inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: p.headers(admin) });
      await withDb(async (db) => {
        const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, sessionId));
        expect(rows.map((r) => r.actionCode).sort()).toEqual(['support_session.ended', 'support_session.started']);
        expect(rows.every((r) => r.tenantId === A.tenantId && r.actorType === 'platform_admin' && r.actorId === admin.admin.id)).toBe(true);
      });
    });
  });

  // ------------------------------------------------------------------------------------------------
  // ONBOARDING / INVITATIONS / REVOCATION
  // ------------------------------------------------------------------------------------------------
  describe('tenant onboarding, invitations and revocation', () => {
    const tokenOf = (url: string): string => url.split('/accept-invitation/')[1]!;
    const create = (s: PlatformSession, companyName: string, adminEmail: string) =>
      p.inject({ method: 'POST', url: '/api/v1/platform/tenants', headers: p.headers(s), payload: { companyName, adminEmail, adminFullName: 'Iso New Admin' } });
    const tenantRowCount = (name: string) => withDb(async (db) => (await db.select().from(schema.tenants).where(eq(schema.tenants.name, name))).length);

    it('ISO-ONB-01 anonymous AND tenant Administrador are refused on every onboarding / invitation / lifecycle route; nothing is created', async () => {
      const name = `Iso Denied Co ${uniq()}`;
      const routes = [
        { method: 'GET' as const, url: '/api/v1/platform/tenants' },
        { method: 'GET' as const, url: `/api/v1/platform/tenants/${A.tenantId}` },
        { method: 'POST' as const, url: '/api/v1/platform/tenants', payload: { companyName: name, adminEmail: `denied-${uniq()}@example.com`, adminFullName: 'X' } },
        { method: 'GET' as const, url: `/api/v1/platform/tenants/${A.tenantId}/admin-invitation` },
        { method: 'POST' as const, url: `/api/v1/platform/tenants/${A.tenantId}/admin-invitation/resend` },
        { method: 'POST' as const, url: `/api/v1/platform/tenants/${A.tenantId}/admin-invitation/revoke` },
        { method: 'POST' as const, url: `/api/v1/platform/tenants/${B.tenantId}/suspend` },
        { method: 'POST' as const, url: `/api/v1/platform/tenants/${B.tenantId}/activate` },
      ];
      for (const r of routes) {
        const anon = await p.inject({ method: r.method, url: r.url, ...('payload' in r ? { payload: r.payload } : {}) });
        expectDenied(anon, [401], `anonymous ${r.method} ${r.url}`);
        const tenantAdmin = await p.inject({ method: r.method, url: r.url, headers: c.writeHeaders(A.admin), ...('payload' in r ? { payload: r.payload } : {}) });
        expectDenied(tenantAdmin, [401, 403], `tenant admin ${r.method} ${r.url}`);
      }
      expect(await tenantRowCount(name)).toBe(0);
      // B was never suspended by the attempts.
      const status = await withDb(async (db) => (await db.select({ s: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, B.tenantId)))[0]?.s);
      expect(status).toBe('active');
    });

    it('ISO-ONB-02 the invitation token resolves to ITS tenant only: the accepted admin lands in the new tenant and sees none of A/B', async () => {
      const admin = await p.newAdmin();
      const email = `iso-new-${uniq()}@example.com`;
      const created = await create(admin, `Iso New Co ${uniq()}`, email);
      expect(created.statusCode, created.body).toBe(201);
      const body = JSON.parse(created.body) as { tenant: { id: string }; invitationUrl: string };
      const token = tokenOf(body.invitationUrl);

      const info = await p.inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` });
      const infoBody = JSON.parse(info.body) as Record<string, unknown>;
      expect(Object.keys(infoBody).sort()).toEqual(['email', 'expiresAt', 'tenantName', 'valid'].filter((k) => k in infoBody).sort());
      expectNoLeak(info.body, [A.tenantId, B.tenantId, A.email, B.email], 'invitation info');
      expect(info.body).not.toMatch(/password|hash/i);

      const accepted = await p.inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token, password: 'brand-new-password-123' } });
      expect(accepted.statusCode, accepted.body).toBe(200);
      const user = (JSON.parse(accepted.body) as { user: { id: string; tenantId: string } }).user;
      expect(user.tenantId).toBe(body.tenant.id);
      expect(user.tenantId).not.toBe(A.tenantId);
      expect(user.tenantId).not.toBe(B.tenantId);

      const fresh: Session = { user: { ...user, tenantSlug: '' }, accessToken: p.cookieValue(accepted, 'access_token')!, csrfToken: p.cookieValue(accepted, 'csrf_token')! };
      for (const [label, url] of [
        ['A warehouse', `/api/v1/warehouses/${A.warehouseId}`],
        ['B warehouse', `/api/v1/warehouses/${B.warehouseId}`],
      ] as const) {
        const res = await p.inject({ method: 'GET', url, headers: c.readHeaders(fresh) });
        expectDenied(res, [404], `new tenant admin reading ${label}`);
      }
      const warehouses = await p.inject({ method: 'GET', url: '/api/v1/warehouses', headers: c.readHeaders(fresh) });
      expectNoLeak(warehouses.body, [A.warehouseId, B.warehouseId, A.warehouseName, B.warehouseName], 'new tenant warehouse list');
      const users = await p.inject({ method: 'GET', url: '/api/v1/users', headers: c.readHeaders(fresh) });
      expectNoLeak(users.body, [A.email, B.email], 'new tenant user list');
    });

    it('ISO-ONB-03 accept-invitation cannot be steered to another tenant: extra tenantId/email/role fields are rejected and nothing is created', async () => {
      const admin = await p.newAdmin();
      const email = `iso-steer-${uniq()}@example.com`;
      const created = await create(admin, `Iso Steer Co ${uniq()}`, email);
      const token = tokenOf((JSON.parse(created.body) as { invitationUrl: string }).invitationUrl);
      for (const extra of [{ tenantId: A.tenantId }, { email: A.email }, { roleId: A.tenantId }, { tenantSlug: 'x' }]) {
        const res = await p.inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token, password: 'brand-new-password-123', ...extra } });
        expectDenied(res, [400], `steered accept ${JSON.stringify(extra)}`);
      }
      const identity = await withDb(async (db) => (await db.select().from(schema.identities).where(eq(schema.identities.email, email)))[0]);
      expect(identity?.status).toBe('pending_credential');
      expect(identity?.passwordHash).toBeNull();
    });

    it('ISO-ONB-04 REVOCATION: a revoked token is dead at both endpoints, no password gets set, and replaying an accepted token fails without a second membership', async () => {
      const admin = await p.newAdmin();
      const email = `iso-revoke-${uniq()}@example.com`;
      const created = await create(admin, `Iso Revoke Co ${uniq()}`, email);
      const body = JSON.parse(created.body) as { tenant: { id: string }; invitationUrl: string };
      const token = tokenOf(body.invitationUrl);

      const revoked = await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${body.tenant.id}/admin-invitation/revoke`, headers: p.headers(admin) });
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect(JSON.parse((await p.inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` })).body)).toEqual({ valid: false, reason: 'revoked' });
      const dead = await p.inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token, password: 'brand-new-password-123' } });
      expectDenied(dead, [401], 'accept revoked token');
      const identity = await withDb(async (db) => (await db.select().from(schema.identities).where(eq(schema.identities.email, email)))[0]);
      expect(identity?.passwordHash, 'revoked invitation must not set a password').toBeNull();
      expect((await p.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'brand-new-password-123' } })).statusCode).toBe(401);

      // resend → a NEW token works once; the replay is refused and adds no membership.
      const resent = await p.inject({ method: 'POST', url: `/api/v1/platform/tenants/${body.tenant.id}/admin-invitation/resend`, headers: p.headers(admin) });
      expect(resent.statusCode, resent.body).toBe(200);
      const fresh = tokenOf((JSON.parse(resent.body) as { invitationUrl: string }).invitationUrl);
      expect(fresh).not.toBe(token);
      expect((await p.inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token: fresh, password: 'brand-new-password-123' } })).statusCode).toBe(200);
      const membershipsAfterAccept = await withDb(async (db) => (await db.select().from(schema.tenantMemberships).where(eq(schema.tenantMemberships.tenantId, body.tenant.id))).length);
      const replay = await p.inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token: fresh, password: 'another-password-456' } });
      expectDenied(replay, [401], 'replay accepted token');
      expect(await withDb(async (db) => (await db.select().from(schema.tenantMemberships).where(eq(schema.tenantMemberships.tenantId, body.tenant.id))).length)).toBe(membershipsAfterAccept);
      // the replay must not have changed the password
      expect((await p.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'another-password-456' } })).statusCode).toBe(401);
      expect((await p.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'brand-new-password-123' } })).statusCode).toBe(200);
    });

    it('ISO-ONB-05 unknown / malformed / hostile tokens are answered uniformly and never as a server error or a data leak', async () => {
      const hostile = ['x', 'a'.repeat(5000), "'; drop table tenants;--", '../../etc/passwd', '%00', A.tenantId, A.email];
      const infoBodies = new Set<string>();
      for (const t of hostile) {
        const info = await p.inject({ method: 'GET', url: `/api/v1/auth/invitations/${encodeURIComponent(t)}` });
        expect(info.statusCode, `info ${t.slice(0, 20)} -> ${info.body.slice(0, 120)}`).toBeLessThan(500);
        infoBodies.add(info.statusCode === 200 ? JSON.stringify((JSON.parse(info.body) as { valid: boolean }).valid) : String(info.statusCode));
        expectNoLeak(info.body, [A.tenantId, B.tenantId, A.email, B.email], `info for hostile token`);
        const accept = await p.inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token: t, password: 'brand-new-password-123' } });
        expect(accept.statusCode, `accept ${t.slice(0, 20)}`).toBeLessThan(500);
        expect(accept.statusCode).not.toBe(200);
      }
      // Hostile tokens must be indistinguishable from each other (no oracle).
      expect(infoBodies.size).toBeLessThanOrEqual(2);
    });

    it('ISO-ONB-06 re-onboarding an EXISTING identity does not alter the original tenant: no invitation, original data/roles intact, original admin still scoped to A', async () => {
      const admin = await p.newAdmin();
      const rolesBefore = await withDb(async (db) => (await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, A.admin.user.id))).length);
      const name = `Iso Reuse Co ${uniq()}`;
      const reused = await create(admin, name, A.email);
      expect(reused.statusCode, reused.body).toBe(201);
      const body = JSON.parse(reused.body) as { identityReused: boolean; invitationUrl?: string; tenant: { id: string } };
      expect(body.identityReused).toBe(true);
      expect(body.invitationUrl, 'an ACTIVE identity must never receive an invitation link').toBeUndefined();
      expect(await withDb(async (db) => (await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, A.admin.user.id))).length)).toBe(rolesBefore);

      // A's existing session still reads A and never the new tenant's data.
      const mine = await p.inject({ method: 'GET', url: `/api/v1/warehouses/${A.warehouseId}`, headers: c.readHeaders(A.admin) });
      expect(mine.statusCode).toBe(200);
      const list = await p.inject({ method: 'GET', url: '/api/v1/users', headers: c.readHeaders(A.admin) });
      expect(JSON.stringify((JSON.parse(list.body) as { data: Array<{ tenantId?: string }> }).data.map((u) => u.tenantId ?? A.tenantId))).not.toContain(body.tenant.id);
    });

    it('ISO-ONB-07 invitation management is platform-only and tenant-bound: unknown tenant 404, malformed 400, and an invitation never leaks across tenants', async () => {
      const admin = await p.newAdmin();
      const created = await create(admin, `Iso Mgmt Co ${uniq()}`, `iso-mgmt-${uniq()}@example.com`);
      const newTenantId = (JSON.parse(created.body) as { tenant: { id: string } }).tenant.id;
      const nil = '00000000-0000-0000-0000-000000000000';
      for (const action of ['', '/resend', '/revoke']) {
        const method = action === '' ? ('GET' as const) : ('POST' as const);
        const unknown = await p.inject({ method, url: `/api/v1/platform/tenants/${nil}/admin-invitation${action}`, headers: p.headers(admin) });
        // GET status of an unknown tenant is `200 null` (no existence oracle); resend/revoke of one is a 404. Never a 5xx, never data.
        expectDenied(unknown, action === '' ? [200, 404] : [404], `unknown tenant ${action}`);
        expectNoLeak(unknown.body, [A.tenantId, B.tenantId, A.email, B.email], `unknown tenant ${action}`);
        expectDenied(await p.inject({ method, url: `/api/v1/platform/tenants/not-a-uuid/admin-invitation${action}`, headers: p.headers(admin) }), [400], `malformed tenant ${action}`);
      }
      // A tenant with no pending invitation (A: founding admin registered with a password) exposes none.
      const aStatus = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${A.tenantId}/admin-invitation`, headers: p.headers(admin) });
      expect(aStatus.statusCode).toBeLessThan(500);
      const newStatus = await p.inject({ method: 'GET', url: `/api/v1/platform/tenants/${newTenantId}/admin-invitation`, headers: p.headers(admin) });
      expect(newStatus.statusCode).toBe(200);
      expect(newStatus.body).not.toMatch(/token|hash/i);
      expectNoLeak(newStatus.body, [A.tenantId, B.tenantId], 'invitation status');
    });
  });
});
