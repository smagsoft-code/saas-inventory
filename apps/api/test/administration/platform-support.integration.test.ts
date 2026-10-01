import { generateId } from '@saas-inventory/shared';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb } from '../database/helpers';

/**
 * ADR-0036 (Tenant Support) — support session lifecycle (start/end/current) and the curated
 * SUPPORT_READ/SUPPORT_WRITE surface. Same boot/inject convention as
 * platform-tenant-onboarding.integration.test.ts.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('administration: platform tenant support (integration, ADR-0036)', () => {
  let app: NestFastifyApplication;
  const PLATFORM_ADMIN_PASSWORD = 'a-very-long-platform-admin-password';
  let platformAdminEmail: string;

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
    process.env['AUTH_RATE_LIMIT_MAX'] = '1000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';
    process.env['SUPPORT_SESSION_TTL_SECONDS'] = '2';

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

  function inject(options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse> {
    return app.getHttpAdapter().getInstance().inject(options as InjectOptions);
  }

  function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
    const raw = response.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) return value;
    }
    return undefined;
  }

  function cookieHeader(cookies: Record<string, string | undefined>): string {
    return Object.entries(cookies)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  interface PlatformSession {
    admin: { id: string; email: string };
    accessToken: string;
    csrfToken: string;
  }
  interface TenantSession {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    csrfToken: string;
  }

  function platformWriteHeaders(session: PlatformSession): Record<string, string> {
    return {
      cookie: cookieHeader({ platform_access_token: session.accessToken, platform_csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }
  function tenantWriteHeaders(session: TenantSession): Record<string, string> {
    return {
      cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  async function loginPlatformAdmin(): Promise<PlatformSession> {
    const response = await inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: platformAdminEmail, password: PLATFORM_ADMIN_PASSWORD } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { admin: PlatformSession['admin'] };
    return { admin: body.admin, accessToken: cookieValue(response, 'platform_access_token')!, csrfToken: cookieValue(response, 'platform_csrf_token')! };
  }

  async function registerTenant(companyName: string, email: string): Promise<TenantSession> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/register', payload: { companyName, email, password: 'a-very-long-password', fullName: 'Founding Admin' } });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: TenantSession['user'] };
    return { user: body.user, accessToken: cookieValue(response, 'access_token')!, csrfToken: cookieValue(response, 'csrf_token')! };
  }

  async function createWarehouse(tenant: TenantSession, name: string): Promise<string> {
    const response = await inject({ method: 'POST', url: '/api/v1/warehouses', headers: tenantWriteHeaders(tenant), payload: { name, code: `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}` } });
    expect(response.statusCode, response.body).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  async function startSession(admin: PlatformSession, tenantId: string, mode: 'read' | 'write', reason = 'diagnosing an issue'): Promise<LightMyRequestResponse> {
    return inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/support-sessions`, headers: platformWriteHeaders(admin), payload: { mode, reason } });
  }

  describe('session lifecycle', () => {
    it('starts a read session, current reflects it, end closes it, and current is null afterward', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support Lifecycle Co', `support-life-${generateId()}@example.com`);

      const started = await startSession(admin, tenant.user.tenantId, 'read', 'checking configuration');
      expect(started.statusCode, started.body).toBe(201);
      const startedBody = JSON.parse(started.body) as { id: string; status: string; mode: string };
      expect(startedBody.status).toBe('active');
      expect(startedBody.mode).toBe('read');

      const current = await inject({ method: 'GET', url: '/api/v1/platform/support-sessions/current', headers: platformWriteHeaders(admin) });
      expect(JSON.parse(current.body).id).toBe(startedBody.id);

      const ended = await inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: platformWriteHeaders(admin) });
      expect(JSON.parse(ended.body).status).toBe('ended');

      const currentAfterEnd = await inject({ method: 'GET', url: '/api/v1/platform/support-sessions/current', headers: platformWriteHeaders(admin) });
      expect(JSON.parse(currentAfterEnd.body)).toBeNull();
    });

    it('starting a session on a different tenant supersedes (ends) the previous one — never two active at once', async () => {
      const admin = await loginPlatformAdmin();
      const tenantA = await registerTenant('Support Multi A Co', `support-multi-a-${generateId()}@example.com`);
      const tenantB = await registerTenant('Support Multi B Co', `support-multi-b-${generateId()}@example.com`);

      const first = await startSession(admin, tenantA.user.tenantId, 'read');
      const firstId = (JSON.parse(first.body) as { id: string }).id;

      const second = await startSession(admin, tenantB.user.tenantId, 'read');
      expect(second.statusCode).toBe(201);

      const current = await inject({ method: 'GET', url: '/api/v1/platform/support-sessions/current', headers: platformWriteHeaders(admin) });
      const currentBody = JSON.parse(current.body) as { tenantId: string };
      expect(currentBody.tenantId).toBe(tenantB.user.tenantId);

      const { client, db } = getMigratorDb();
      try {
        const [row] = await db.select().from(schema.platformSupportSessions).where(eq(schema.platformSupportSessions.id, firstId));
        expect(row?.status).toBe('ended');
      } finally {
        await client.end();
      }
    });

    it('expires after SUPPORT_SESSION_TTL_SECONDS — GET current returns null and the guard rejects support-scoped calls', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support Expiry Co', `support-expiry-${generateId()}@example.com`);
      const started = await startSession(admin, tenant.user.tenantId, 'read');
      expect(started.statusCode).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 2500));

      const current = await inject({ method: 'GET', url: '/api/v1/platform/support-sessions/current', headers: platformWriteHeaders(admin) });
      expect(JSON.parse(current.body)).toBeNull();

      const usersCall = await inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenant.user.tenantId}/support/users`, headers: platformWriteHeaders(admin) });
      expect(usersCall.statusCode).toBe(403);
    }, 15_000);
  });

  describe('SUPPORT_READ', () => {
    it('lists users and warehouses once a session is active; rejects without one; rejects cross-tenant even with a live session on another tenant', async () => {
      const admin = await loginPlatformAdmin();
      const tenantA = await registerTenant('Support Read A Co', `support-read-a-${generateId()}@example.com`);
      const tenantB = await registerTenant('Support Read B Co', `support-read-b-${generateId()}@example.com`);
      await createWarehouse(tenantA, 'Almacén Principal');

      const noSession = await inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenantA.user.tenantId}/support/users`, headers: platformWriteHeaders(admin) });
      expect(noSession.statusCode).toBe(403);

      await startSession(admin, tenantA.user.tenantId, 'read');

      const users = await inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenantA.user.tenantId}/support/users`, headers: platformWriteHeaders(admin) });
      expect(users.statusCode).toBe(200);
      const userRows = JSON.parse(users.body) as { email: string; roleNames: string[] }[];
      expect(userRows.some((u) => u.roleNames.includes('Administrador'))).toBe(true);
      expect(JSON.stringify(userRows)).not.toMatch(/passwordHash/i);

      const warehouses = await inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenantA.user.tenantId}/support/warehouses`, headers: platformWriteHeaders(admin) });
      expect(JSON.parse(warehouses.body)).toHaveLength(1);

      // A live session on tenant A cannot be used to read tenant B's data by editing the URL.
      const crossTenant = await inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenantB.user.tenantId}/support/users`, headers: platformWriteHeaders(admin) });
      expect(crossTenant.statusCode).toBe(403);
    });
  });

  describe('SUPPORT_WRITE', () => {
    it('a READ session cannot perform the write action (403); a WRITE session can, and it is audited with before/after/session/reason', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support Write Co', `support-write-${generateId()}@example.com`);
      const warehouseId = await createWarehouse(tenant, 'Bodega Central');

      await startSession(admin, tenant.user.tenantId, 'read');
      const blockedInReadMode = await inject({
        method: 'PATCH',
        url: `/api/v1/platform/tenants/${tenant.user.tenantId}/support/warehouses/${warehouseId}/status`,
        headers: platformWriteHeaders(admin),
        payload: { status: 'inactive' },
      });
      expect(blockedInReadMode.statusCode).toBe(403);

      const writeSession = await startSession(admin, tenant.user.tenantId, 'write', 'disabling a misconfigured warehouse');
      const writeSessionId = (JSON.parse(writeSession.body) as { id: string }).id;

      const updated = await inject({
        method: 'PATCH',
        url: `/api/v1/platform/tenants/${tenant.user.tenantId}/support/warehouses/${warehouseId}/status`,
        headers: platformWriteHeaders(admin),
        payload: { status: 'inactive' },
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(JSON.parse(updated.body).status).toBe('inactive');

      const { client, db } = getMigratorDb();
      try {
        const [warehouseRow] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId));
        expect(warehouseRow?.status).toBe('inactive');

        const auditRows = await db
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.actionCode, 'support.warehouse_status_changed'));
        const entry = auditRows.find((row) => row.entityId === warehouseId);
        expect(entry).toBeDefined();
        expect(entry?.actorType).toBe('platform_admin');
        expect(entry?.actorId).toBe(admin.admin.id);
        expect(entry?.tenantId).toBe(tenant.user.tenantId);
        expect(entry?.beforeState).toEqual({ status: 'active' });
        expect(entry?.afterState).toEqual(expect.objectContaining({ status: 'inactive', supportSessionId: writeSessionId, reason: 'disabling a misconfigured warehouse' }));
      } finally {
        await client.end();
      }
    });

    it('an invalid status value is rejected (400), never silently coerced', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support Write Bad Co', `support-write-bad-${generateId()}@example.com`);
      const warehouseId = await createWarehouse(tenant, 'Bodega X');
      await startSession(admin, tenant.user.tenantId, 'write');

      const response = await inject({
        method: 'PATCH',
        url: `/api/v1/platform/tenants/${tenant.user.tenantId}/support/warehouses/${warehouseId}/status`,
        headers: platformWriteHeaders(admin),
        payload: { status: 'deleted' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('session start/end audit', () => {
    it('start and end both write a support_session audit entry, actor = platform admin', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support Audit Co', `support-audit-${generateId()}@example.com`);

      const started = await startSession(admin, tenant.user.tenantId, 'read', 'routine check');
      const sessionId = (JSON.parse(started.body) as { id: string }).id;
      await inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: platformWriteHeaders(admin) });

      const { client, db } = getMigratorDb();
      try {
        const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, sessionId));
        const actionCodes = rows.map((r) => r.actionCode).sort();
        expect(actionCodes).toEqual(['support_session.ended', 'support_session.started']);
        expect(rows.every((r) => r.actorType === 'platform_admin' && r.actorId === admin.admin.id)).toBe(true);
      } finally {
        await client.end();
      }
    });
  });

  describe('security: tenant sessions can never touch support endpoints', () => {
    it('a full-access tenant Administrador is 401/403 on every support-scoped route (never RequirePermissions, always PlatformOnly)', async () => {
      const tenant = await registerTenant('Support Boundary Co', `support-boundary-${generateId()}@example.com`);
      const response = await inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenant.user.tenantId}/support/users`, headers: tenantWriteHeaders(tenant) });
      expect([401, 403]).toContain(response.statusCode);
    });
  });

  /**
   * ADR-0036 extension (the QA/fix pass following the original block) — `TenantGuard` now resolves
   * an active support session as an alternate, GET-only tenant context on the *ordinary* tenant API
   * (never just the curated `/support/*` surface), so a `SUPPORT_READ` session can actually browse
   * the Tenant's real screens (Dashboard, Productos, Inventario, …) rather than only the two
   * curated read endpoints. Proven here at the HTTP layer, not just guard-level unit mocks.
   */
  describe('ADR-0036 extension: general tenant API read-through for an active support session', () => {
    it('rejects an ordinary tenant GET with no active session (no tenant JWT, no support session)', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support ReadThrough No-Session Co', `support-rt-none-${generateId()}@example.com`);

      const response = await inject({ method: 'GET', url: '/api/v1/tenant', headers: platformWriteHeaders(admin) });
      expect(response.statusCode).toBe(403);
      void tenant;
    });

    it('GET /auth/me returns a synthetic support view — never a real users/identities row, includes supportSession', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support ReadThrough Me Co', `support-rt-me-${generateId()}@example.com`);
      const started = await startSession(admin, tenant.user.tenantId, 'read', 'browsing the tenant app');
      const sessionId = (JSON.parse(started.body) as { id: string }).id;

      const me = await inject({ method: 'GET', url: '/api/v1/auth/me', headers: platformWriteHeaders(admin) });
      expect(me.statusCode).toBe(200);
      const body = JSON.parse(me.body) as {
        id: string;
        identityId: string;
        tenantId: string;
        permissions: string[];
        supportSession?: { id: string; mode: string; reason: string; expiresAt: string };
      };
      expect(body.id).toBe(`support:${sessionId}`);
      expect(body.identityId).toBe(`support:${admin.admin.id}`);
      expect(body.tenantId).toBe(tenant.user.tenantId);
      expect(body.permissions.length).toBeGreaterThan(5); // the whole catalog, not a tenant's own set
      expect(body.supportSession).toMatchObject({ id: sessionId, mode: 'read', reason: 'browsing the tenant app' });
    });

    it('GET on ordinary tenant routes (dashboard-adjacent /tenant, /products, /warehouses) succeeds once a session is active', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support ReadThrough Browse Co', `support-rt-browse-${generateId()}@example.com`);
      await createWarehouse(tenant, 'Bodega Central');
      await startSession(admin, tenant.user.tenantId, 'read', 'browsing the tenant app');

      const tenantInfo = await inject({ method: 'GET', url: '/api/v1/tenant', headers: platformWriteHeaders(admin) });
      expect(tenantInfo.statusCode).toBe(200);
      expect((JSON.parse(tenantInfo.body) as { id: string }).id).toBe(tenant.user.tenantId);

      const products = await inject({ method: 'GET', url: '/api/v1/products', headers: platformWriteHeaders(admin) });
      expect(products.statusCode).toBe(200);

      const warehouses = await inject({ method: 'GET', url: '/api/v1/warehouses', headers: platformWriteHeaders(admin) });
      expect(warehouses.statusCode).toBe(200);
      expect((JSON.parse(warehouses.body) as { data: unknown[] }).data).toHaveLength(1);
    });

    it('never leaks a query-param tenantId into the resolved scope — always the session\'s own tenant', async () => {
      const admin = await loginPlatformAdmin();
      const tenantA = await registerTenant('Support ReadThrough Scope A Co', `support-rt-scope-a-${generateId()}@example.com`);
      const tenantB = await registerTenant('Support ReadThrough Scope B Co', `support-rt-scope-b-${generateId()}@example.com`);
      await startSession(admin, tenantA.user.tenantId, 'read', 'checking scope leakage');

      const response = await inject({ method: 'GET', url: `/api/v1/tenant?tenantId=${tenantB.user.tenantId}`, headers: platformWriteHeaders(admin) });
      expect(response.statusCode).toBe(200);
      expect((JSON.parse(response.body) as { id: string }).id).toBe(tenantA.user.tenantId);
    });

    it('rejects every mutation on the general tenant API — GET-only, regardless of session mode (WRITE included)', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support ReadThrough Write-Blocked Co', `support-rt-write-${generateId()}@example.com`);
      await startSession(admin, tenant.user.tenantId, 'write', 'even write mode cannot mutate the general API');

      const createProduct = await inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: platformWriteHeaders(admin),
        payload: { name: 'Should not be created', defaultVariant: { sku: 'X', basePrice: 1, minPrice: 1, maxPrice: 1 } },
      });
      expect(createProduct.statusCode).toBe(403);

      const patchTenant = await inject({
        method: 'PATCH',
        url: '/api/v1/tenant',
        headers: platformWriteHeaders(admin),
        payload: { name: 'Renamed by support' },
      });
      expect(patchTenant.statusCode).toBe(403);
    });

    it('ending the session immediately blocks the general tenant API again', async () => {
      const admin = await loginPlatformAdmin();
      const tenant = await registerTenant('Support ReadThrough End Co', `support-rt-end-${generateId()}@example.com`);
      await startSession(admin, tenant.user.tenantId, 'read', 'about to end');

      const before = await inject({ method: 'GET', url: '/api/v1/tenant', headers: platformWriteHeaders(admin) });
      expect(before.statusCode).toBe(200);

      await inject({ method: 'POST', url: '/api/v1/platform/support-sessions/current/end', headers: platformWriteHeaders(admin) });

      const after = await inject({ method: 'GET', url: '/api/v1/tenant', headers: platformWriteHeaders(admin) });
      expect(after.statusCode).toBe(403);
    });
  });
});
