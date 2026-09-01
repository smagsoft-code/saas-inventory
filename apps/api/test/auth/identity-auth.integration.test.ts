import { sql } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appPlatformIntegrationTestsEnabled,
  getAppPlatformDatabaseUrl,
  getAppPublicResolverDatabaseUrl,
  getMigratorDb,
} from '../database/helpers';

/**
 * 016-C / ADR-0033 — the new email+password authentication flow, end to end through the real
 * guard chain and real app_tenant/app_platform connections against real PostgreSQL. Covers the 16
 * mandatory scenarios from the 016-C brief (§24).
 *
 * Membership / tenant / identity status is forced directly via the migrator (superuser) connection
 * where no API surface exists yet to change it (there is deliberately no membership-management or
 * switch-tenant endpoint in this phase) — same convention the RLS / integrity suites already use.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('identity auth flow (016-C)', () => {
  let app: NestFastifyApplication;
  const PW = 'a-very-long-password';

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
    process.env['AUTH_RATE_LIMIT_MAX'] = '10000';
    process.env['AUTH_RATE_LIMIT_TTL_SECONDS'] = '60';
    process.env['SELECTION_TOKEN_TTL_SECONDS'] = '300';

    const { buildApp } = await import('../../src/main');
    app = await buildApp();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  function inject(options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string> }) {
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
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  interface Admin {
    tenantId: string;
    userId: string;
    accessToken: string;
    csrfToken: string;
  }

  async function register(companyName: string, email: string): Promise<Admin> {
    const r = await inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { companyName, email, password: PW, fullName: 'Admin' },
    });
    expect(r.statusCode, r.body).toBe(201);
    const body = JSON.parse(r.body) as { user: { id: string; tenantId: string } };
    return {
      tenantId: body.user.tenantId,
      userId: body.user.id,
      accessToken: cookieValue(r, 'access_token')!,
      csrfToken: cookieValue(r, 'csrf_token')!,
    };
  }

  async function roleIdByName(admin: Admin, name: string): Promise<string> {
    const r = await inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: { cookie: cookieHeader({ access_token: admin.accessToken }) },
    });
    const roles = JSON.parse(r.body) as { id: string; name: string }[];
    return roles.find((x) => x.name === name)!.id;
  }

  /** Create a user (=> a new membership on the identity for that email) in `admin`'s tenant. */
  async function addUserToTenant(admin: Admin, email: string): Promise<string> {
    const roleId = await roleIdByName(admin, 'Vendedor');
    const r = await inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: {
        cookie: cookieHeader({ access_token: admin.accessToken, csrf_token: admin.csrfToken }),
        'x-csrf-token': admin.csrfToken,
      },
      payload: { email, fullName: 'Multi Member', password: PW, roleId },
    });
    expect(r.statusCode, r.body).toBe(201);
    return (JSON.parse(r.body) as { id: string }).id;
  }

  function login(email: string, password: string) {
    return inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  }

  async function migratorExec(query: ReturnType<typeof sql>): Promise<void> {
    const { client, db } = getMigratorDb();
    try {
      await db.execute(query);
    } finally {
      await client.end();
    }
  }

  // ── Case 15 / 14 ────────────────────────────────────────────────────────────
  it('Case 15: an unknown email is rejected generically', async () => {
    const r = await login('does-not-exist-016c@example.com', PW);
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).message).toBe('Invalid email or password.');
  });

  it('Case 14: a wrong password is rejected generically', async () => {
    await register('C14 Co', 'c14@example.com');
    const r = await login('c14@example.com', 'not-the-password');
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).message).toBe('Invalid email or password.');
  });

  // ── Case 1 / 13 ─────────────────────────────────────────────────────────────
  it('Case 1: correct credentials + exactly one active membership -> a direct session', async () => {
    const admin = await register('C1 Co', 'c1@example.com');
    const r = await login('c1@example.com', PW);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { status: string; user: { tenantId: string; identityId: string } };
    expect(body.status).toBe('authenticated');
    expect(body.user.tenantId).toBe(admin.tenantId);
    expect(typeof body.user.identityId).toBe('string');
    expect(cookieValue(r, 'access_token')).toBeTruthy();
    expect(cookieValue(r, 'refresh_token')).toBeTruthy();
    expect(cookieValue(r, 'tenant_selection')).toBeUndefined();
  });

  it('Case 13: email lookup is case-insensitive', async () => {
    await register('C13 Co', 'c13@example.com');
    const r = await login('C13@Example.COM', PW);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).status).toBe('authenticated');
  });

  // ── Case 2 / 3 / 10 / 11 / 12 ───────────────────────────────────────────────
  describe('multi-membership identity', () => {
    let tenantA: Admin;
    let tenantB: Admin;
    let userIdA: string;
    let userIdB: string;
    const sharedEmail = 'shared-016c@example.com';

    beforeAll(async () => {
      tenantA = await register('C2 Co A', 'c2-adminA@example.com');
      tenantB = await register('C2 Co B', 'c2-adminB@example.com');
      userIdA = await addUserToTenant(tenantA, sharedEmail); // creates the identity + membership A
      userIdB = await addUserToTenant(tenantB, sharedEmail); // adds membership B to the same identity
      expect(userIdA).not.toBe(userIdB);
    });

    it('Case 2: correct credentials + two active memberships -> a selection token, NO business session', async () => {
      const r = await login(sharedEmail, PW);
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body) as {
        status: string;
        availableTenants: { tenantId: string; name: string }[];
        selectionToken: string;
      };
      expect(body.status).toBe('tenant_selection_required');
      expect(body.availableTenants.map((t) => t.tenantId).sort()).toEqual([tenantA.tenantId, tenantB.tenantId].sort());
      expect(cookieValue(r, 'access_token')).toBeUndefined();
      expect(cookieValue(r, 'refresh_token')).toBeUndefined();
      expect(cookieValue(r, 'tenant_selection')).toBeTruthy();

      // The selection token cannot be used as a session (Case 11 setup also relies on this).
      const asSession = await inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: cookieHeader({ access_token: body.selectionToken }) },
      });
      expect(asSession.statusCode).toBe(401);
    });

    it('Case 3 + Case 12: selecting a valid membership issues a session that resolves that tenant\'s own user', async () => {
      const loginResp = await login(sharedEmail, PW);
      const selectionCookie = cookieValue(loginResp, 'tenant_selection')!;

      const selA = await inject({
        method: 'POST',
        url: '/api/v1/auth/select-tenant',
        headers: { cookie: cookieHeader({ tenant_selection: selectionCookie }) },
        payload: { tenantId: tenantA.tenantId },
      });
      expect(selA.statusCode).toBe(200);
      const bodyA = JSON.parse(selA.body) as { user: { id: string; tenantId: string } };
      expect(bodyA.user.tenantId).toBe(tenantA.tenantId);
      expect(bodyA.user.id).toBe(userIdA);

      const selB = await inject({
        method: 'POST',
        url: '/api/v1/auth/select-tenant',
        headers: { cookie: cookieHeader({ tenant_selection: cookieValue(await login(sharedEmail, PW), 'tenant_selection')! }) },
        payload: { tenantId: tenantB.tenantId },
      });
      expect(selB.statusCode).toBe(200);
      const bodyB = JSON.parse(selB.body) as { user: { id: string; tenantId: string } };
      expect(bodyB.user.tenantId).toBe(tenantB.tenantId);
      expect(bodyB.user.id).toBe(userIdB); // Case 12: each tenant resolves its own user row.
    });

    it('Case 4: a selection token cannot select a tenant the identity has no membership for', async () => {
      const outsider = await register('C4 Outsider', 'c4-outsider@example.com');
      const selectionCookie = cookieValue(await login(sharedEmail, PW), 'tenant_selection')!;
      const r = await inject({
        method: 'POST',
        url: '/api/v1/auth/select-tenant',
        headers: { cookie: cookieHeader({ tenant_selection: selectionCookie }) },
        payload: { tenantId: outsider.tenantId },
      });
      expect(r.statusCode).toBe(401);
      expect(JSON.parse(r.body).message).toBe('Invalid or expired selection.');
    });

    it('Case 5: an expired selection token is rejected', async () => {
      // Mint a selection token that is already expired, signed with the same secret + purpose.
      const { JwtService } = await import('@nestjs/jwt');
      const jwt = new JwtService({});
      const loginResp = await login(sharedEmail, PW);
      const goodPayload = jwt.decode<{ sub: string }>(cookieValue(loginResp, 'tenant_selection')!);
      const expired = await jwt.signAsync(
        { sub: goodPayload.sub, purpose: 'tenant-selection', jti: 'x' },
        { secret: 'integration-test-jwt-secret', expiresIn: -10 },
      );
      const r = await inject({
        method: 'POST',
        url: '/api/v1/auth/select-tenant',
        payload: { tenantId: tenantA.tenantId, selectionToken: expired },
      });
      expect(r.statusCode).toBe(401);
      expect(JSON.parse(r.body).message).toBe('Invalid or expired selection.');
    });

    it('Case 6: a disabled membership is not offered and cannot be selected', async () => {
      await migratorExec(
        sql`update tenant_memberships set status = 'disabled' where tenant_id = ${tenantB.tenantId}::uuid and user_id = ${userIdB}::uuid`,
      );
      // Now only membership A is active -> a direct session for A, B never appears.
      const r = await login(sharedEmail, PW);
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body) as { status: string; user?: { tenantId: string } };
      expect(body.status).toBe('authenticated');
      expect(body.user?.tenantId).toBe(tenantA.tenantId);
      await migratorExec(
        sql`update tenant_memberships set status = 'active' where tenant_id = ${tenantB.tenantId}::uuid and user_id = ${userIdB}::uuid`,
      );
    });

    it('Case 10 + Case 11: a session for tenant A never grants tenant B; a separate selection yields an independent tenant-B session', async () => {
      const selectionCookie = cookieValue(await login(sharedEmail, PW), 'tenant_selection')!;
      const selA = await inject({
        method: 'POST',
        url: '/api/v1/auth/select-tenant',
        headers: { cookie: cookieHeader({ tenant_selection: selectionCookie }) },
        payload: { tenantId: tenantA.tenantId },
      });
      const tokenA = cookieValue(selA, 'access_token')!;

      // Case 10: /auth/me with tenant A's token resolves tenant A only.
      const meA = await inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookieHeader({ access_token: tokenA }) } });
      expect(JSON.parse(meA.body).tenantId).toBe(tenantA.tenantId);
      expect(JSON.parse(meA.body).tenantId).not.toBe(tenantB.tenantId);

      // Case 11: a fresh selection of tenant B yields a token scoped to tenant B, independent of A's.
      const selB = await inject({
        method: 'POST',
        url: '/api/v1/auth/select-tenant',
        headers: { cookie: cookieHeader({ tenant_selection: cookieValue(await login(sharedEmail, PW), 'tenant_selection')! }) },
        payload: { tenantId: tenantB.tenantId },
      });
      const meB = await inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: cookieHeader({ access_token: cookieValue(selB, 'access_token')! }) },
      });
      expect(JSON.parse(meB.body).tenantId).toBe(tenantB.tenantId);
    });
  });

  // ── Case 7 / 8 / 9 / 16 ─────────────────────────────────────────────────────
  it('Case 7: a disabled tenant blocks login', async () => {
    const admin = await register('C7 Co', 'c7@example.com');
    await migratorExec(sql`update tenants set status = 'suspended' where id = ${admin.tenantId}::uuid`);
    const r = await login('c7@example.com', PW);
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).message).toBe('Invalid email or password.');
    await migratorExec(sql`update tenants set status = 'active' where id = ${admin.tenantId}::uuid`);
  });

  it('Case 8: a disabled identity blocks login', async () => {
    await register('C8 Co', 'c8@example.com');
    await migratorExec(sql`update identities set status = 'disabled' where lower(email) = 'c8@example.com'`);
    const r = await login('c8@example.com', PW);
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).message).toBe('Invalid email or password.');
  });

  it('Case 9: a pending_credential identity cannot complete a normal login (no users.password_hash fallback)', async () => {
    await register('C9 Co', 'c9@example.com');
    await migratorExec(sql`update identities set status = 'pending_credential', password_hash = null where lower(email) = 'c9@example.com'`);
    const r = await login('c9@example.com', PW);
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).message).toBe('Invalid email or password.');
  });

  it('Case 16: an identity whose only membership is disabled cannot log in', async () => {
    const admin = await register('C16 Co', 'c16@example.com');
    await migratorExec(
      sql`update tenant_memberships set status = 'disabled' where tenant_id = ${admin.tenantId}::uuid and user_id = ${admin.userId}::uuid`,
    );
    const r = await login('c16@example.com', PW);
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).message).toBe('Invalid email or password.');
  });

  it('users.password_hash is left intact for every created user (016-C §19)', async () => {
    await register('PH Co', 'ph@example.com');
    const { client } = getMigratorDb();
    try {
      const rows = await client<{ password_hash: string | null }[]>`
        select u.password_hash from users u where lower(u.email) = 'ph@example.com'`;
      expect(rows[0]?.password_hash).toBeTruthy();
    } finally {
      await client.end();
    }
  });
});
