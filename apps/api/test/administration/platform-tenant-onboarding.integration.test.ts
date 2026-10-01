import { generateId } from '@saas-inventory/shared';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { appPlatformIntegrationTestsEnabled, getAppPlatformDatabaseUrl, getAppPublicResolverDatabaseUrl, getMigratorDb } from '../database/helpers';

/**
 * ADR-0036 (Tenant Onboarding) — `POST /platform/tenants` (create tenant + admin, no password),
 * the invitation lifecycle (resend/revoke/status), and `POST /auth/accept-invitation`. Same
 * boot/inject convention as test/administration/platform-admin.integration.test.ts.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('administration: platform tenant onboarding (integration, ADR-0036)', () => {
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

  function platformWriteHeaders(session: PlatformSession): Record<string, string> {
    return {
      cookie: cookieHeader({ platform_access_token: session.accessToken, platform_csrf_token: session.csrfToken }),
      'x-csrf-token': session.csrfToken,
    };
  }

  async function loginPlatformAdmin(): Promise<PlatformSession> {
    const response = await inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: platformAdminEmail, password: PLATFORM_ADMIN_PASSWORD } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { admin: PlatformSession['admin'] };
    return { admin: body.admin, accessToken: cookieValue(response, 'platform_access_token')!, csrfToken: cookieValue(response, 'platform_csrf_token')! };
  }

  async function createTenant(admin: PlatformSession, companyName: string, adminEmail: string, adminFullName = 'New Admin') {
    return inject({
      method: 'POST',
      url: '/api/v1/platform/tenants',
      headers: platformWriteHeaders(admin),
      payload: { companyName, adminEmail, adminFullName },
    });
  }

  describe('POST /platform/tenants — email nuevo', () => {
    it('creates tenant + admin + roles + a pending_credential identity + a live invitation, never a password field anywhere', async () => {
      const admin = await loginPlatformAdmin();
      const email = `admin-${generateId()}@example.com`;

      const response = await createTenant(admin, 'Onboarding Co', email);
      expect(response.statusCode, response.body).toBe(201);
      const body = JSON.parse(response.body) as {
        tenant: { id: string; status: string };
        admin: { id: string; email: string };
        identityReused: boolean;
        invitationUrl: string;
        invitationExpiresAt: string;
      };
      expect(body.tenant.status).toBe('active');
      expect(body.admin.email).toBe(email);
      expect(body.identityReused).toBe(false);
      expect(body.invitationUrl).toContain('/accept-invitation/');
      expect(JSON.stringify(body)).not.toMatch(/password/i);

      // The founding admin cannot log in yet — pending_credential, no password ever set.
      const loginAttempt = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'anything-at-all-12345' } });
      expect(loginAttempt.statusCode).toBe(401);

      // Confirmed directly against the DB: identity is pending_credential with a NULL hash, the
      // membership is already active, the user holds the Administrador role.
      const { client, db } = getMigratorDb();
      try {
        const [identity] = await db.select().from(schema.identities).where(eq(schema.identities.email, email));
        expect(identity?.status).toBe('pending_credential');
        expect(identity?.passwordHash).toBeNull();

        const [membership] = await db.select().from(schema.tenantMemberships).where(eq(schema.tenantMemberships.userId, body.admin.id));
        expect(membership?.status).toBe('active');

        const roleRows = await db
          .select({ name: schema.roles.name })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(eq(schema.userRoles.userId, body.admin.id));
        expect(roleRows.map((r) => r.name)).toContain('Administrador');
      } finally {
        await client.end();
      }
    });
  });

  describe('POST /platform/tenants — email existente (activo)', () => {
    it('reuses the active identity, creates no invitation, and the new admin can log in immediately with their existing password', async () => {
      const admin = await loginPlatformAdmin();
      const sharedEmail = `shared-${generateId()}@example.com`;

      // First tenant via self-service register — a real active identity with a real password.
      const registerResponse = await inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { companyName: 'Original Co', email: sharedEmail, password: 'original-password-123', fullName: 'Original Admin' },
      });
      expect(registerResponse.statusCode).toBe(201);

      // SuperAdmin provisions a SECOND tenant for the same email.
      const response = await createTenant(admin, 'Second Co', sharedEmail, 'Second Admin');
      expect(response.statusCode, response.body).toBe(201);
      const body = JSON.parse(response.body) as { identityReused: boolean; invitationUrl?: string; admin: { id: string } };
      expect(body.identityReused).toBe(true);
      expect(body.invitationUrl).toBeUndefined();

      // Logs in with the ORIGINAL password (never a password from this second call — none was
      // ever sent) and is offered both tenants.
      const loginResponse = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: sharedEmail, password: 'original-password-123' } });
      expect(loginResponse.statusCode).toBe(200);
      const loginBody = JSON.parse(loginResponse.body) as { status: string; availableTenants: { tenantId: string }[] };
      expect(loginBody.status).toBe('tenant_selection_required');
      expect(loginBody.availableTenants.length).toBe(2);
    });
  });

  describe('POST /platform/tenants — email existente (disabled)', () => {
    it('refuses to provision and compensates — tenant ends up suspended, user soft-deleted, never a silently unreachable admin', async () => {
      const admin = await loginPlatformAdmin();
      const disabledEmail = `disabled-${generateId()}@example.com`;

      const { client, db } = getMigratorDb();
      let tenantIdBefore: string;
      try {
        // Seed a disabled identity directly (no endpoint disables an identity yet).
        await db.insert(schema.identities).values({ id: generateId(), email: disabledEmail, passwordHash: 'x', status: 'disabled', fullName: 'Disabled Person' });

        const response = await createTenant(admin, 'Doomed Co', disabledEmail);
        expect(response.statusCode).toBe(409);
        const body = JSON.parse(response.body) as { message: string };
        expect(body.message).toMatch(/disabled/i);

        // Find the tenant this call must have created-then-compensated, by name.
        const [tenantRow] = await db.select().from(schema.tenants).where(eq(schema.tenants.name, 'Doomed Co'));
        expect(tenantRow).toBeDefined();
        tenantIdBefore = tenantRow!.id;
        expect(tenantRow!.status).toBe('suspended');

        const [userRow] = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantIdBefore));
        expect(userRow?.deletedAt).not.toBeNull();
      } finally {
        await client.end();
      }
      expect(tenantIdBefore!).toBeTruthy();
    });
  });

  describe('invitation lifecycle: status / resend / revoke', () => {
    it('GET status reflects sent; resend supersedes the old token (old one stops working); revoke invalidates', async () => {
      const admin = await loginPlatformAdmin();
      const email = `lifecycle-${generateId()}@example.com`;
      const created = await createTenant(admin, 'Lifecycle Co', email);
      const createdBody = JSON.parse(created.body) as { tenant: { id: string }; invitationUrl: string };
      const tenantId = createdBody.tenant.id;
      const firstToken = createdBody.invitationUrl.split('/accept-invitation/')[1]!;

      const statusResponse = await inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenantId}/admin-invitation`, headers: platformWriteHeaders(admin) });
      expect(statusResponse.statusCode).toBe(200);
      expect(JSON.parse(statusResponse.body).status).toBe('sent');

      const resendResponse = await inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/admin-invitation/resend`, headers: platformWriteHeaders(admin) });
      expect(resendResponse.statusCode).toBe(200);
      const resendBody = JSON.parse(resendResponse.body) as { invitationUrl: string };
      const secondToken = resendBody.invitationUrl.split('/accept-invitation/')[1]!;
      expect(secondToken).not.toBe(firstToken);

      // The OLD token no longer works.
      const oldInfo = await inject({ method: 'GET', url: `/api/v1/auth/invitations/${firstToken}` });
      expect(JSON.parse(oldInfo.body).valid).toBe(false);
      // The NEW one does.
      const newInfo = await inject({ method: 'GET', url: `/api/v1/auth/invitations/${secondToken}` });
      expect(JSON.parse(newInfo.body)).toEqual(expect.objectContaining({ valid: true, tenantName: 'Lifecycle Co', email }));

      const revokeResponse = await inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/admin-invitation/revoke`, headers: platformWriteHeaders(admin) });
      expect(revokeResponse.statusCode).toBe(200);
      expect(JSON.parse(revokeResponse.body).status).toBe('revoked');

      const infoAfterRevoke = await inject({ method: 'GET', url: `/api/v1/auth/invitations/${secondToken}` });
      expect(JSON.parse(infoAfterRevoke.body)).toEqual({ valid: false, reason: 'revoked' });
    });

    it('resending twice never leaves two live tokens — only the newest ever validates', async () => {
      const admin = await loginPlatformAdmin();
      const email = `multi-resend-${generateId()}@example.com`;
      const created = await createTenant(admin, 'Multi Resend Co', email);
      const tenantId = (JSON.parse(created.body) as { tenant: { id: string } }).tenant.id;

      await inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/admin-invitation/resend`, headers: platformWriteHeaders(admin) });
      const third = await inject({ method: 'POST', url: `/api/v1/platform/tenants/${tenantId}/admin-invitation/resend`, headers: platformWriteHeaders(admin) });
      const thirdToken = (JSON.parse(third.body) as { invitationUrl: string }).invitationUrl.split('/accept-invitation/')[1]!;

      const { client, db } = getMigratorDb();
      try {
        const liveRows = await db
          .select()
          .from(schema.tenantAdminInvitations)
          .where(eq(schema.tenantAdminInvitations.tenantId, tenantId));
        const live = liveRows.filter((r) => r.status === 'pending' || r.status === 'sent');
        expect(live).toHaveLength(1);
        expect(live[0]!.status).toBe('sent');
      } finally {
        await client.end();
      }

      const info = await inject({ method: 'GET', url: `/api/v1/auth/invitations/${thirdToken}` });
      expect(JSON.parse(info.body).valid).toBe(true);
    });
  });

  describe('POST /auth/accept-invitation', () => {
    it('sets the password, activates the identity, marks the invitation accepted, and issues a working session', async () => {
      const admin = await loginPlatformAdmin();
      const email = `accept-${generateId()}@example.com`;
      const created = await createTenant(admin, 'Accept Co', email, 'Accept Admin');
      const createdBody = JSON.parse(created.body) as { invitationUrl: string; tenant: { id: string } };
      const token = createdBody.invitationUrl.split('/accept-invitation/')[1]!;

      const acceptResponse = await inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token, password: 'brand-new-password-123' } });
      expect(acceptResponse.statusCode, acceptResponse.body).toBe(200);
      const acceptBody = JSON.parse(acceptResponse.body) as { user: { tenantId: string; email: string } };
      expect(acceptBody.user.tenantId).toBe(createdBody.tenant.id);
      expect(cookieValue(acceptResponse, 'access_token')).toBeTruthy();

      // The SAME token cannot be reused.
      const secondAttempt = await inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token, password: 'another-password-456' } });
      expect(secondAttempt.statusCode).toBe(401);

      // A normal login now works with the just-set password.
      const login = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'brand-new-password-123' } });
      expect(login.statusCode).toBe(200);
    });

    it('rejects an expired invitation (backdated directly in the DB) with a clear GET .../invitations/:token reason', async () => {
      const admin = await loginPlatformAdmin();
      const email = `expired-${generateId()}@example.com`;
      const created = await createTenant(admin, 'Expired Co', email);
      const token = (JSON.parse(created.body) as { invitationUrl: string }).invitationUrl.split('/accept-invitation/')[1]!;

      const { client, db } = getMigratorDb();
      try {
        await db.update(schema.tenantAdminInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.tenantAdminInvitations.tenantId, JSON.parse(created.body).tenant.id));
      } finally {
        await client.end();
      }

      const info = await inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` });
      expect(JSON.parse(info.body)).toEqual({ valid: false, reason: 'expired' });

      const acceptResponse = await inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token, password: 'irrelevant-password-1' } });
      expect(acceptResponse.statusCode).toBe(401);
    });

    it('an unknown token is rejected generically (401), never distinguishing from any other failure at the accept endpoint', async () => {
      const response = await inject({ method: 'POST', url: '/api/v1/auth/accept-invitation', payload: { token: 'totally-made-up-token-value-xyz', password: 'irrelevant-password-1' } });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('security: anonymous / non-platform-admin cannot touch onboarding endpoints', () => {
    it('401 anonymous on POST /platform/tenants', async () => {
      const anon = await inject({
        method: 'POST',
        url: '/api/v1/platform/tenants',
        payload: { companyName: 'Should Not Exist Co', adminEmail: 'x@example.com', adminFullName: 'Nobody' },
      });
      expect(anon.statusCode).toBe(401);
    });
  });
});
