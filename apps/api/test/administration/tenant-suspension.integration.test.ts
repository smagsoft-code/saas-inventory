import { generateId } from '@saas-inventory/shared';
import * as argon2 from 'argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb } from '../database/helpers';

/**
 * PROMPT 011-A — the mandatory T1-T9 closure evidence: a tenant suspended via
 * POST /platform/tenants/:tenantId/suspend must immediately stop being usable through every
 * tenant-scoped path (new login, refresh of an already-issued token, and a request carrying an
 * access token minted before the suspension), across more than one bounded context, without
 * affecting any other tenant or platform administration itself. Same boot/inject convention as
 * test/administration/platform-admin.integration.test.ts. Skipped (not failed) unless
 * TEST_MIGRATOR_DATABASE_URL/TEST_APP_TENANT_DATABASE_URL/TEST_APP_PLATFORM_DATABASE_URL are all
 * set — see test/database/helpers.ts. Does NOT call resetAndMigrate() itself (global-setup.ts
 * already does this once for the whole run).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('administration: tenant suspension enforcement (integration)', () => {
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

    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();

    platformAdminEmail = `superadmin-suspend-${generateId()}@example.com`;
    const passwordHash = await argon2.hash(PLATFORM_ADMIN_PASSWORD, { type: argon2.argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1 });
    const { client, db } = getMigratorDb();
    try {
      await db.insert(schema.platformAdmins).values({
        id: generateId(),
        email: platformAdminEmail,
        passwordHash,
        fullName: 'Test SuperAdmin (suspension suite)',
      });
    } finally {
      await client.end();
    }
  }, 60_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  function inject(options: {
    method: HTTPMethods;
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }): Promise<LightMyRequestResponse> {
    return app.getHttpAdapter().getInstance().inject(options as InjectOptions);
  }

  function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
    const raw = response.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) {
        return value;
      }
    }
    return undefined;
  }

  function cookieHeader(cookies: Record<string, string | undefined>): string {
    return Object.entries(cookies)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  interface TenantSession {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }

  interface PlatformSession {
    admin: { id: string; email: string };
    accessToken: string;
    csrfToken: string;
  }

  function tenantReadHeaders(session: TenantSession): Record<string, string> {
    return { cookie: cookieHeader({ access_token: session.accessToken }) };
  }

  function tenantWriteHeaders(session: TenantSession): Record<string, string> {
    return {
      cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  function platformWriteHeaders(session: PlatformSession): Record<string, string> {
    return {
      cookie: cookieHeader({ platform_access_token: session.accessToken, platform_csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  async function registerTenant(companyName: string, email: string): Promise<TenantSession> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: TenantSession['user'] };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      refreshToken: cookieValue(response, 'refresh_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  async function loginPlatformAdmin(): Promise<PlatformSession> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/platform/auth/login',
      payload: { email: platformAdminEmail, password: PLATFORM_ADMIN_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { admin: PlatformSession['admin'] };
    return {
      admin: body.admin,
      accessToken: cookieValue(response, 'platform_access_token')!,
      csrfToken: cookieValue(response, 'platform_csrf_token')!,
    };
  }

  async function suspendTenant(platformSession: PlatformSession, tenantId: string): Promise<void> {
    const response = await inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/suspend`,
      headers: platformWriteHeaders(platformSession),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe('suspended');
  }

  async function activateTenant(platformSession: PlatformSession, tenantId: string): Promise<void> {
    const response = await inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/activate`,
      headers: platformWriteHeaders(platformSession),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe('active');
  }

  // T1 — login.
  it('T1: a suspended tenant rejects a brand-new login attempt with valid credentials; an active one still succeeds', async () => {
    const tenant = await registerTenant('Suspend-T1 Co', 'admin@suspend-t1.example');
    const platformSession = await loginPlatformAdmin();

    const loginWhileActive = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@suspend-t1.example', password: 'a-very-long-password' },
    });
    expect(loginWhileActive.statusCode).toBe(200);

    await suspendTenant(platformSession, tenant.user.tenantId);

    const loginWhileSuspended = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@suspend-t1.example', password: 'a-very-long-password' },
    });
    expect(loginWhileSuspended.statusCode).toBe(401);
    expect(cookieValue(loginWhileSuspended, 'access_token')).toBeUndefined();
    expect(cookieValue(loginWhileSuspended, 'refresh_token')).toBeUndefined();
  });

  // T2 — refresh.
  it('T2: a refresh token minted while active is rejected once the tenant is suspended, no new token issued', async () => {
    const tenant = await registerTenant('Suspend-T2 Co', 'admin@suspend-t2.example');
    const platformSession = await loginPlatformAdmin();

    await suspendTenant(platformSession, tenant.user.tenantId);

    const refreshResponse = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: cookieHeader({ refresh_token: tenant.refreshToken, csrf_token: tenant.csrfToken }),
        'x-csrf-token': tenant.csrfToken,
      },
    });
    expect(refreshResponse.statusCode).toBe(401);
    expect(cookieValue(refreshResponse, 'access_token')).toBeUndefined();
  });

  // T3 — the core scenario: an access token minted before suspension.
  it('T3: an access token issued while active is rejected on GET /tenant once the tenant is suspended (before the token expires)', async () => {
    const tenant = await registerTenant('Suspend-T3 Co', 'admin@suspend-t3.example');
    const platformSession = await loginPlatformAdmin();

    const beforeSuspend = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenant) });
    expect(beforeSuspend.statusCode).toBe(200);

    await suspendTenant(platformSession, tenant.user.tenantId);

    const afterSuspend = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenant) });
    expect(afterSuspend.statusCode).toBe(403);
  });

  // T4 — a second bounded context, proving the block is central (TenantGuard), not TenantController-specific.
  it('T4: the same pre-suspension access token is also rejected on a CATALOG endpoint (GET /categories)', async () => {
    const tenant = await registerTenant('Suspend-T4 Co', 'admin@suspend-t4.example');
    const platformSession = await loginPlatformAdmin();

    const beforeSuspend = await inject({ method: 'GET', url: '/api/v1/categories', headers: tenantReadHeaders(tenant) });
    expect(beforeSuspend.statusCode).toBe(200);

    await suspendTenant(platformSession, tenant.user.tenantId);

    const afterSuspend = await inject({ method: 'GET', url: '/api/v1/categories', headers: tenantReadHeaders(tenant) });
    expect(afterSuspend.statusCode).toBe(403);
  });

  // T5 — reactivation: documents the actual, chosen semantics (see final report).
  it('T5: after reactivation, the same pre-existing access token works again with no new login required', async () => {
    const tenant = await registerTenant('Suspend-T5 Co', 'admin@suspend-t5.example');
    const platformSession = await loginPlatformAdmin();

    await suspendTenant(platformSession, tenant.user.tenantId);
    const whileSuspended = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenant) });
    expect(whileSuspended.statusCode).toBe(403);

    await activateTenant(platformSession, tenant.user.tenantId);

    const afterReactivation = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenant) });
    expect(afterReactivation.statusCode).toBe(200);
    expect(JSON.parse(afterReactivation.body).id).toBe(tenant.user.tenantId);

    // The refresh token issued at registration also still works — never revoked by suspend.
    const refreshAfterReactivation = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: cookieHeader({ refresh_token: tenant.refreshToken, csrf_token: tenant.csrfToken }),
        'x-csrf-token': tenant.csrfToken,
      },
    });
    expect(refreshAfterReactivation.statusCode).toBe(200);
  });

  // T6 — platform admin must remain fully operational against a suspended tenant.
  it('T6: platform admin can still GET and re-activate a tenant while it is suspended', async () => {
    const tenant = await registerTenant('Suspend-T6 Co', 'admin@suspend-t6.example');
    const platformSession = await loginPlatformAdmin();

    await suspendTenant(platformSession, tenant.user.tenantId);

    const getWhileSuspended = await inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${tenant.user.tenantId}`,
      headers: { cookie: cookieHeader({ platform_access_token: platformSession.accessToken }) },
    });
    expect(getWhileSuspended.statusCode).toBe(200);
    expect(JSON.parse(getWhileSuspended.body).status).toBe('suspended');

    await activateTenant(platformSession, tenant.user.tenantId);
  });

  // T7 — no cross-tenant blast radius.
  it('T7: suspending tenant A never affects tenant B', async () => {
    const tenantA = await registerTenant('Suspend-T7-A Co', 'admin@suspend-t7-a.example');
    const tenantB = await registerTenant('Suspend-T7-B Co', 'admin@suspend-t7-b.example');
    const platformSession = await loginPlatformAdmin();

    await suspendTenant(platformSession, tenantA.user.tenantId);

    const requestA = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenantA) });
    expect(requestA.statusCode).toBe(403);

    const requestB = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenantB) });
    expect(requestB.statusCode).toBe(200);
    expect(JSON.parse(requestB.body).id).toBe(tenantB.user.tenantId);

    const loginB = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@suspend-t7-b.example', password: 'a-very-long-password' },
    });
    expect(loginB.statusCode).toBe(200);
  });

  // T8 — tenant isolation (RLS) is a separate, untouched concern from status enforcement.
  it('T8: suspending tenant A does not expose or alter tenant B rows — tenant isolation is unaffected by status enforcement', async () => {
    const tenantA = await registerTenant('Suspend-T8-A Co', 'admin@suspend-t8-a.example');
    const tenantB = await registerTenant('Suspend-T8-B Co', 'admin@suspend-t8-b.example');
    const platformSession = await loginPlatformAdmin();

    await suspendTenant(platformSession, tenantA.user.tenantId);

    // Tenant B, still active, still only ever sees its own tenant via the ordinary tenant-scoped
    // route — suspension of A introduces no cross-tenant leak or side effect on B's own context.
    const getB = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenantB) });
    expect(getB.statusCode).toBe(200);
    expect(JSON.parse(getB.body).id).toBe(tenantB.user.tenantId);
    expect(JSON.parse(getB.body).id).not.toBe(tenantA.user.tenantId);
  });

  // T9 — the commit boundary: before the suspend call commits, the tenant still operates normally;
  // from the very next request resolution after it commits, it does not. No mid-flight-abort
  // guarantee is asserted (rule 33) — only that resolution after COMMIT observes the new status.
  it('T9: the tenant operates normally right up to the suspend call, and is rejected on the very next request after it', async () => {
    const tenant = await registerTenant('Suspend-T9 Co', 'admin@suspend-t9.example');
    const platformSession = await loginPlatformAdmin();

    const justBeforeSuspend = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenant) });
    expect(justBeforeSuspend.statusCode).toBe(200);

    await suspendTenant(platformSession, tenant.user.tenantId); // awaited — commit boundary.

    const justAfterSuspend = await inject({ method: 'GET', url: '/api/v1/tenant', headers: tenantReadHeaders(tenant) });
    expect(justAfterSuspend.statusCode).toBe(403);
  });

  // §39 anti-escalation: a tenant admin can never reactivate its own tenant via the tenant-scoped
  // surface — PATCH /tenant only ever accepts `name` (whitelisted), same proof already established
  // by test/core/users-rbac.integration.test.ts's mass-assignment case, re-asserted here in the
  // specific context of a suspended tenant trying to self-reactivate.
  it('anti-escalation: a suspended tenant cannot reactivate itself via PATCH /tenant', async () => {
    const tenant = await registerTenant('Suspend-Escalation Co', 'admin@suspend-escalation.example');
    const platformSession = await loginPlatformAdmin();
    await suspendTenant(platformSession, tenant.user.tenantId);

    const selfReactivateAttempt = await inject({
      method: 'PATCH',
      url: '/api/v1/tenant',
      headers: tenantWriteHeaders(tenant),
      payload: { name: 'Still Suspended Co', status: 'active' },
    });
    // Rejected two ways, both sufficient: TenantGuard blocks it (403) before the controller is ever
    // reached; even if it somehow weren't, `status` isn't a whitelisted field on UpdateTenantDto
    // (400). Either outcome proves self-reactivation is impossible via this route.
    expect([400, 403]).toContain(selfReactivateAttempt.statusCode);

    const stillSuspended = await inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${tenant.user.tenantId}`,
      headers: { cookie: cookieHeader({ platform_access_token: platformSession.accessToken }) },
    });
    expect(JSON.parse(stillSuspended.body).status).toBe('suspended');
  });
});
