import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb } from '../database/helpers';

/**
 * PROMPT 011-B — the mandatory U1-U9 closure evidence: a user disabled via
 * `PATCH /users/:id { status: 'disabled' }` must immediately stop being usable through every
 * tenant-scoped path (new login, refresh of an already-issued token, and a request carrying an
 * access token minted before deactivation), across more than one bounded context, without
 * affecting any other user or tenant. Same boot/inject convention as
 * test/administration/tenant-suspension.integration.test.ts. Skipped (not failed) unless
 * TEST_MIGRATOR_DATABASE_URL/TEST_APP_TENANT_DATABASE_URL/TEST_APP_PLATFORM_DATABASE_URL are all
 * set. Does NOT call resetAndMigrate() itself (global-setup.ts already does this once).
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('administration: user status enforcement (integration)', () => {
  let app: NestFastifyApplication;

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

  interface Session {
    user: { id: string; tenantId: string; tenantSlug: string };
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }

  function readHeaders(session: Session): Record<string, string> {
    return { cookie: cookieHeader({ access_token: session.accessToken }) };
  }

  function writeHeaders(session: Session): Record<string, string> {
    return {
      cookie: cookieHeader({ access_token: session.accessToken, csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  async function registerTenant(companyName: string, email: string): Promise<Session> {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: 'a-very-long-password', fullName: 'Test Admin' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      refreshToken: cookieValue(response, 'refresh_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  async function loginAs(email: string, password: string): Promise<Session> {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { user: Session['user'] };
    return {
      user: body.user,
      accessToken: cookieValue(response, 'access_token')!,
      refreshToken: cookieValue(response, 'refresh_token')!,
      csrfToken: cookieValue(response, 'csrf_token')!,
    };
  }

  /** Creates a second, ordinary ("Vendedor") user in the admin's tenant and logs it in for its
   * own session — the "target" whose status this suite flips. Never the admin itself: the admin
   * cannot deactivate its own account (ADR-0031's unconditional self-status-block), so a second
   * user is required regardless. */
  async function createAndLoginUser(admin: Session, email: string): Promise<Session> {
    const rolesResponse = await inject({ method: 'GET', url: '/api/v1/roles', headers: readHeaders(admin) });
    const roles = JSON.parse(rolesResponse.body) as { id: string; name: string }[];
    const vendedorRoleId = roles.find((r) => r.name === 'Vendedor')?.id;
    if (!vendedorRoleId) throw new Error('Vendedor role not found');

    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(admin),
      payload: { email, fullName: 'Target User', password: 'a-very-long-password', roleId: vendedorRoleId },
    });
    expect(createResponse.statusCode).toBe(201);
    const targetId = JSON.parse(createResponse.body).id as string;
    const session = await loginAs(email, 'a-very-long-password');
    return { ...session, user: { ...session.user, id: targetId } };
  }

  async function setUserStatus(admin: Session, targetUserId: string, status: 'active' | 'disabled'): Promise<void> {
    const response = await inject({
      method: 'PATCH',
      url: `/api/v1/users/${targetUserId}`,
      headers: writeHeaders(admin),
      payload: { status },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe(status);
  }

  // U1 — login.
  it('U1: a disabled user rejects a brand-new login attempt with valid credentials; an active one still succeeds', async () => {
    const admin = await registerTenant('UserStatus-U1 Co', 'admin@userstatus-u1.example');
    const target = await createAndLoginUser(admin, 'target@userstatus-u1.example');

    const loginWhileActive = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'target@userstatus-u1.example', password: 'a-very-long-password' },
    });
    expect(loginWhileActive.statusCode).toBe(200);

    await setUserStatus(admin, target.user.id, 'disabled');

    const loginWhileDisabled = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'target@userstatus-u1.example', password: 'a-very-long-password' },
    });
    expect(loginWhileDisabled.statusCode).toBe(401);
    expect(cookieValue(loginWhileDisabled, 'access_token')).toBeUndefined();
  });

  // U2 — refresh.
  it('U2: a refresh token minted while active is rejected once the user is disabled, no new token issued', async () => {
    const admin = await registerTenant('UserStatus-U2 Co', 'admin@userstatus-u2.example');
    const target = await createAndLoginUser(admin, 'target@userstatus-u2.example');

    await setUserStatus(admin, target.user.id, 'disabled');

    const refreshResponse = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: cookieHeader({ refresh_token: target.refreshToken, csrf_token: target.csrfToken }),
        'x-csrf-token': target.csrfToken,
      },
    });
    expect(refreshResponse.statusCode).toBe(401);
    expect(cookieValue(refreshResponse, 'access_token')).toBeUndefined();
  });

  // U3 — the core scenario: an access token minted before deactivation.
  it('U3: an access token issued while active is rejected on GET /tenant once the user is disabled (before the token expires)', async () => {
    const admin = await registerTenant('UserStatus-U3 Co', 'admin@userstatus-u3.example');
    const target = await createAndLoginUser(admin, 'target@userstatus-u3.example');

    const beforeDisable = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(target) });
    expect(beforeDisable.statusCode).toBe(200);

    await setUserStatus(admin, target.user.id, 'disabled');

    const afterDisable = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(target) });
    expect(afterDisable.statusCode).toBe(403);
  });

  // U4 — a second bounded context, proving the block is central (TenantGuard).
  it('U4: the same pre-deactivation access token is also rejected on a CATALOG endpoint (GET /categories)', async () => {
    const admin = await registerTenant('UserStatus-U4 Co', 'admin@userstatus-u4.example');
    const target = await createAndLoginUser(admin, 'target@userstatus-u4.example');

    const beforeDisable = await inject({ method: 'GET', url: '/api/v1/categories', headers: readHeaders(target) });
    expect(beforeDisable.statusCode).toBe(200);

    await setUserStatus(admin, target.user.id, 'disabled');

    const afterDisable = await inject({ method: 'GET', url: '/api/v1/categories', headers: readHeaders(target) });
    expect(afterDisable.statusCode).toBe(403);
  });

  // U5 — reactivation: documents the actual, chosen semantics (mirrors PROMPT 011-A's tenant one).
  it('U5: after reactivation, the same pre-existing access token works again with no new login required', async () => {
    const admin = await registerTenant('UserStatus-U5 Co', 'admin@userstatus-u5.example');
    const target = await createAndLoginUser(admin, 'target@userstatus-u5.example');

    await setUserStatus(admin, target.user.id, 'disabled');
    const whileDisabled = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(target) });
    expect(whileDisabled.statusCode).toBe(403);

    await setUserStatus(admin, target.user.id, 'active');

    const afterReactivation = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(target) });
    expect(afterReactivation.statusCode).toBe(200);

    const refreshAfterReactivation = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: cookieHeader({ refresh_token: target.refreshToken, csrf_token: target.csrfToken }),
        'x-csrf-token': target.csrfToken,
      },
    });
    expect(refreshAfterReactivation.statusCode).toBe(200);
  });

  // U6 — no blast radius onto another user in the same tenant.
  it('U6: disabling user A never affects user B in the same tenant', async () => {
    const admin = await registerTenant('UserStatus-U6 Co', 'admin@userstatus-u6.example');
    const userA = await createAndLoginUser(admin, 'usera@userstatus-u6.example');
    const userB = await createAndLoginUser(admin, 'userb@userstatus-u6.example');

    await setUserStatus(admin, userA.user.id, 'disabled');

    const requestA = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(userA) });
    expect(requestA.statusCode).toBe(403);

    const requestB = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(userB) });
    expect(requestB.statusCode).toBe(200);
  });

  // U7 — no cross-tenant blast radius.
  it('U7: disabling a user in tenant A never affects a user in tenant B', async () => {
    const adminA = await registerTenant('UserStatus-U7-A Co', 'admin@userstatus-u7-a.example');
    const adminB = await registerTenant('UserStatus-U7-B Co', 'admin@userstatus-u7-b.example');
    const userA = await createAndLoginUser(adminA, 'target@userstatus-u7-a.example');
    const userB = await createAndLoginUser(adminB, 'target@userstatus-u7-b.example');

    await setUserStatus(adminA, userA.user.id, 'disabled');

    const requestA = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(userA) });
    expect(requestA.statusCode).toBe(403);

    const requestB = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(userB) });
    expect(requestB.statusCode).toBe(200);
  });

  // U8 — the user the token names no longer exists (soft-deleted). No HTTP-reachable user-delete
  // endpoint exists (FASE 5 never built one) — simulated directly at the data layer, the same way
  // this suite's sibling files seed fixtures outside the HTTP surface.
  it('U8: a token whose user has since been soft-deleted is rejected, not a 500', async () => {
    const admin = await registerTenant('UserStatus-U8 Co', 'admin@userstatus-u8.example');
    const target = await createAndLoginUser(admin, 'target@userstatus-u8.example');

    const beforeDelete = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(target) });
    expect(beforeDelete.statusCode).toBe(200);

    const { client } = getMigratorDb();
    try {
      await client`update users set deleted_at = now() where id = ${target.user.id}`;
    } finally {
      await client.end();
    }

    const afterDelete = await inject({ method: 'GET', url: '/api/v1/tenant', headers: readHeaders(target) });
    expect(afterDelete.statusCode).toBe(403);
  });

  // U9 — anti-escalation: a disabled user cannot use its own still-valid token to reactivate
  // itself (or do anything else) — blocked centrally before ever reaching the controller/
  // ADR-0031 self-escalation check.
  it('U9: a disabled user cannot reactivate itself via PATCH /users/:id using its own token', async () => {
    const admin = await registerTenant('UserStatus-U9 Co', 'admin@userstatus-u9.example');
    const target = await createAndLoginUser(admin, 'target@userstatus-u9.example');
    await setUserStatus(admin, target.user.id, 'disabled');

    const selfReactivateAttempt = await inject({
      method: 'PATCH',
      url: `/api/v1/users/${target.user.id}`,
      headers: writeHeaders(target),
      payload: { status: 'active' },
    });
    expect(selfReactivateAttempt.statusCode).toBe(403);

    const stillDisabled = await inject({
      method: 'GET',
      url: `/api/v1/users/${target.user.id}`,
      headers: readHeaders(admin),
    });
    expect(JSON.parse(stillDisabled.body).status).toBe('disabled');
  });
});
