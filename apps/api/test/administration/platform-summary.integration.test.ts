import { generateId } from '@saas-inventory/shared';
import * as argon2 from 'argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb } from '../database/helpers';

/**
 * F18-10 — `GET /api/v1/platform/summary` end to end against real PostgreSQL, through the real
 * `buildApp()`: `@PlatformOnly()` (401 anon / 403 tenant session / 200 platform admin), the
 * `tenants`-only aggregation (`totalCount` / `byStatus` / `demoCount`), the optional half-open
 * `[from, to)` `newInPeriod` count, both-or-neither `from`/`to` validation, and the cross-tenant
 * safety properties (a tenant session — even a full-access Administrador — never reaches it; the
 * response carries only numeric aggregates, never an individual tenant's id/name/slug).
 *
 * `platform_admins` has no self-service registration, so the suite seeds its own row via the
 * migrator connection (same convention as test/administration/platform-admin.integration.test.ts).
 * `tenants.created_at` is backdated via a direct UPDATE on the disposable pg-verify database only —
 * the HTTP contract has no way to set it (a tenant's `created_at` is `now()` at `POST /auth/register`).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('administration: platform summary (integration, F18-10)', () => {
  let app: NestFastifyApplication;
  const PLATFORM_ADMIN_PASSWORD = 'a-very-long-platform-admin-password';
  let platformAdminEmail: string;

  interface TenantSession {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    csrfToken: string;
  }
  interface PlatformSession {
    accessToken: string;
    csrfToken: string;
  }

  function inject(options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse> {
    return app.getHttpAdapter().getInstance().inject(options as InjectOptions);
  }
  const cookieValue = (res: LightMyRequestResponse, name: string): string | undefined => {
    const raw = res.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) return value;
    }
    return undefined;
  };
  const cookieHeader = (c: Record<string, string | undefined>): string =>
    Object.entries(c).filter((e): e is [string, string] => e[1] !== undefined).map(([k, v]) => `${k}=${v}`).join('; ');

  const tenantReadHeaders = (s: TenantSession) => ({ cookie: cookieHeader({ access_token: s.accessToken }) });
  const platformReadHeaders = (s: PlatformSession) => ({ cookie: cookieHeader({ platform_access_token: s.accessToken }) });
  const platformWriteHeaders = (s: PlatformSession) => ({
    cookie: cookieHeader({ platform_access_token: s.accessToken, platform_csrf_token: s.csrfToken }),
    'x-csrf-token': s.csrfToken,
  });

  async function registerTenant(companyName: string, email: string): Promise<TenantSession> {
    const res = await inject({ method: 'POST', url: '/api/v1/auth/register', payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' } });
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body) as { user: TenantSession['user'] };
    return { user: body.user, accessToken: cookieValue(res, 'access_token')!, csrfToken: cookieValue(res, 'csrf_token')! };
  }

  async function loginPlatformAdmin(): Promise<PlatformSession> {
    const res = await inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: platformAdminEmail, password: PLATFORM_ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return { accessToken: cookieValue(res, 'platform_access_token')!, csrfToken: cookieValue(res, 'platform_csrf_token')! };
  }

  async function backdateCreatedAt(tenantId: string, iso: string): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      await db.update(schema.tenants).set({ createdAt: new Date(iso) }).where(eq(schema.tenants.id, tenantId));
    } finally {
      await client.end();
    }
  }

  interface Body {
    generatedAt: string;
    totalCount: number;
    byStatus: { active: number; suspended: number; archived: number };
    demoCount: number;
    period: { from: string; to: string; newInPeriod: number } | null;
  }
  function summary(session: PlatformSession, qs = ''): Promise<LightMyRequestResponse> {
    return inject({ method: 'GET', url: `/api/v1/platform/summary${qs}`, headers: platformReadHeaders(session) });
  }
  const parse = (res: { body: string }): Body => JSON.parse(res.body) as Body;
  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_APP_TENANT_DATABASE_URL'];
    process.env['APP_PLATFORM_DATABASE_URL'] = getAppPlatformDatabaseUrl();
    process.env['APP_PUBLIC_RESOLVER_DATABASE_URL'] = getAppPublicResolverDatabaseUrl();
    process.env['JWT_SECRET'] = 'integration-test-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'integration-test-refresh-pepper';
    process.env['CORS_ORIGINS'] = 'http://localhost:3000';
    process.env['ARGON2_MEMORY_COST_KIB'] = '8192';
    process.env['ARGON2_TIME_COST'] = '2';
    process.env['ARGON2_PARALLELISM'] = '1';
    process.env['AUTH_RATE_LIMIT_MAX'] = '5000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';

    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();

    platformAdminEmail = `superadmin-${generateId()}@example.com`;
    const passwordHash = await argon2.hash(PLATFORM_ADMIN_PASSWORD, { type: argon2.argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1 });
    const { client, db } = getMigratorDb();
    try {
      await db.insert(schema.platformAdmins).values({ id: generateId(), email: platformAdminEmail, passwordHash, fullName: 'Test SuperAdmin' });
    } finally {
      await client.end();
    }
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- access control -----------------------------------------------------------

  it('an unauthenticated caller is 401', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/platform/summary' });
    expect(res.statusCode).toBe(401);
  });

  it('a tenant session — even a full-access Administrador — is 403 (never reaches a @PlatformOnly route)', async () => {
    const admin = await registerTenant(`PlatSummary Tenant ${uniq()}`, `admin@plat-summary-tenant-${uniq()}.example`);
    const res = await inject({ method: 'GET', url: '/api/v1/platform/summary', headers: tenantReadHeaders(admin) });
    expect(res.statusCode).toBe(403);
    // and there is no tenantId parameter that could widen scope
    const res2 = await inject({ method: 'GET', url: `/api/v1/platform/summary?tenantId=${admin.user.tenantId}`, headers: tenantReadHeaders(admin) });
    expect(res2.statusCode).toBe(403);
  });

  it('a platform admin gets 200 with numeric aggregates only — no individual tenant id/name/slug', async () => {
    const session = await loginPlatformAdmin();
    const res = await summary(session);
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.totalCount).toBeGreaterThan(0); // the demo seed tenant at least
    expect(body.period).toBeNull();
    expect(typeof body.generatedAt).toBe('string');
    // data minimisation: only numeric aggregates, no tenant identifiers, no tenant-scoped data
    const raw = res.body;
    expect(raw).not.toMatch(/"slug"/);
    expect(raw).not.toMatch(/"name"/);
    expect(raw).not.toMatch(/"users"|"orders"|"currency"|"timezone"/);
  });

  // ---- validation --------------------------------------------------------------

  it('400 when only one of from/to is given, or from >= to', async () => {
    const session = await loginPlatformAdmin();
    expect((await summary(session, '?from=2026-09-01T00:00:00.000Z')).statusCode).toBe(400);
    expect((await summary(session, '?to=2026-09-01T00:00:00.000Z')).statusCode).toBe(400);
    expect((await summary(session, '?from=2026-09-02T00:00:00.000Z&to=2026-09-01T00:00:00.000Z')).statusCode).toBe(400);
    expect((await summary(session, '?from=not-a-date&to=2026-09-01T00:00:00.000Z')).statusCode).toBe(400);
  });

  // ---- cardinality + multi-tenant aggregation --------------------------------

  it('registering N tenants raises totalCount by at least N; byStatus always sums to totalCount exactly', async () => {
    const session = await loginPlatformAdmin();
    const before = parse(await summary(session));

    await registerTenant(`PlatSummary A ${uniq()}`, `a-${uniq()}@plat-sum.example`);
    await registerTenant(`PlatSummary B ${uniq()}`, `b-${uniq()}@plat-sum.example`);
    await registerTenant(`PlatSummary C ${uniq()}`, `c-${uniq()}@plat-sum.example`);

    const after = parse(await summary(session));
    // >= 3, not === 3: the integration files run in parallel against ONE database and every file
    // registers its own tenants, so the platform-wide count can rise by more than this test's own 3.
    // It can never rise by less; the exact invariant (buckets partition the table) is asserted below.
    expect(after.totalCount - before.totalCount).toBeGreaterThanOrEqual(3);
    expect(after.byStatus.active - before.byStatus.active).toBeGreaterThanOrEqual(3);
    // single-table COUNT — the status buckets partition the whole table, exactly, with no fan-out
    expect(after.byStatus.active + after.byStatus.suspended + after.byStatus.archived).toBe(after.totalCount);
  });

  it('suspending a tenant moves it from the active bucket to the suspended bucket (delta assertion)', async () => {
    const session = await loginPlatformAdmin();
    const t = await registerTenant(`PlatSummary Susp ${uniq()}`, `susp-${uniq()}@plat-sum.example`);
    const before = parse(await summary(session));

    const suspend = await inject({ method: 'POST', url: `/api/v1/platform/tenants/${t.user.tenantId}/suspend`, headers: platformWriteHeaders(session) });
    expect(suspend.statusCode).toBe(200);

    const after = parse(await summary(session));
    expect(after.byStatus.suspended - before.byStatus.suspended).toBe(1);
    expect(after.byStatus.active - before.byStatus.active).toBe(-1);
    expect(after.totalCount).toBe(before.totalCount); // suspension is not deletion
  });

  // ---- [from, to) on created_at --------------------------------------------

  it('newInPeriod counts only tenants whose created_at is in the half-open [from, to) window', async () => {
    const session = await loginPlatformAdmin();
    const from = new Date(Date.UTC(2019, 0, 1));
    const to = new Date(Date.UTC(2019, 1, 1)); // Jan 2019
    const interior = new Date(Date.UTC(2019, 0, 15)).toISOString();
    const before = new Date(Date.UTC(2018, 11, 31)).toISOString();

    const inWindow = await registerTenant(`PlatSummary InWin ${uniq()}`, `inwin-${uniq()}@plat-sum.example`);
    const outWindow = await registerTenant(`PlatSummary OutWin ${uniq()}`, `outwin-${uniq()}@plat-sum.example`);
    await backdateCreatedAt(inWindow.user.tenantId, interior);
    await backdateCreatedAt(outWindow.user.tenantId, before);

    const res = await summary(session, `?from=${from.toISOString()}&to=${to.toISOString()}`);
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.period).toEqual({ from: from.toISOString(), to: to.toISOString(), newInPeriod: 1 });
    // the point-in-time counts are unaffected by the period param
    expect(body.totalCount).toBeGreaterThanOrEqual(2);
  });

  it('a window with no tenant created in it returns period.newInPeriod: 0 (never an error)', async () => {
    const session = await loginPlatformAdmin();
    const res = await summary(session, '?from=1990-01-01T00:00:00.000Z&to=1990-02-01T00:00:00.000Z');
    expect(res.statusCode).toBe(200);
    expect(parse(res).period?.newInPeriod).toBe(0);
  });
});
