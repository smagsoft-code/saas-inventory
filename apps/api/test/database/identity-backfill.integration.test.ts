import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateId } from '@saas-inventory/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { getMigratorDb, integrationTestsEnabled } from './helpers';

/**
 * 016-B / ADR-0033 — the `identities` + `tenant_memberships` backfill (migration `0029`).
 *
 * Migration `0029` already ran once (against an empty database, so it was a real no-op) as part
 * of global-setup.ts's single resetAndMigrate() for this whole suite. Every test below inserts its
 * OWN `users` fixtures directly (as app_migrator/superuser via getMigratorDb(), which bypasses RLS
 * — same convention as integrity.integration.test.ts) and then RE-RUNS the exact SQL migration 0029
 * ships (read from disk, split on the same `--> statement-breakpoint` markers Drizzle's own
 * migrator splits on, executed in one transaction) — proving both that the backfill logic itself
 * is correct against fresh data, and that re-running it is genuinely idempotent (§20/§26 of
 * 016-B), without touching anything the earlier, real, once-only migration run already produced
 * (every fixture here uses a fresh, uniquely generated email/tenant/user, so it can never collide
 * with a pre-existing row).
 */
describe.skipIf(!integrationTestsEnabled)('identity backfill (016-B)', () => {
  const backfillSql = readFileSync(
    join(__dirname, '../../../../database/migrations/0029_backfill_identities.sql'),
    'utf8',
  );

  async function runBackfill(): Promise<void> {
    const { client } = getMigratorDb();
    try {
      const statements = backfillSql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      await client.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
      });
    } finally {
      await client.end();
    }
  }

  async function insertUser(values: {
    tenantId: string;
    email: string;
    passwordHash: string;
    fullName?: string;
    status?: 'invited' | 'active' | 'disabled';
    deletedAt?: Date;
  }): Promise<string> {
    const { client, db } = getMigratorDb();
    try {
      const userId = generateId();
      await db.insert(schema.users).values({
        id: userId,
        tenantId: values.tenantId,
        email: values.email,
        passwordHash: values.passwordHash,
        fullName: values.fullName ?? 'Test User',
        status: values.status ?? 'active',
        deletedAt: values.deletedAt,
      });
      return userId;
    } finally {
      await client.end();
    }
  }

  async function makeTenant(label: string): Promise<string> {
    const { client, db } = getMigratorDb();
    try {
      const tenantId = generateId();
      await db.insert(schema.tenants).values({ id: tenantId, name: `Backfill ${label}`, slug: `backfill-${label}-${generateId()}` });
      return tenantId;
    } finally {
      await client.end();
    }
  }

  async function findIdentityByEmail(email: string) {
    const { client, db } = getMigratorDb();
    try {
      const [row] = await db
        .select()
        .from(schema.identities)
        .where(eq(schema.identities.email, email.trim().toLowerCase()));
      return row;
    } finally {
      await client.end();
    }
  }

  async function membershipsForIdentity(identityId: string) {
    const { client, db } = getMigratorDb();
    try {
      // Must await here, inside the try — returning the un-awaited query builder would let
      // `finally` close the connection (client.end()) before the query actually runs.
      return await db.select().from(schema.tenantMemberships).where(eq(schema.tenantMemberships.identityId, identityId));
    } finally {
      await client.end();
    }
  }

  it('Caso A: a single user for a unique email produces one active identity and one membership', async () => {
    const tenantId = await makeTenant('a');
    const email = `caso-a-${generateId()}@example.com`;
    const userId = await insertUser({ tenantId, email, passwordHash: 'hash-a', fullName: 'Caso A' });

    await runBackfill();

    const identity = await findIdentityByEmail(email);
    expect(identity).toBeDefined();
    expect(identity?.status).toBe('active');
    expect(identity?.passwordHash).toBe('hash-a');
    expect(identity?.fullName).toBe('Caso A');

    const memberships = await membershipsForIdentity(identity!.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.tenantId).toBe(tenantId);
    expect(memberships[0]?.userId).toBe(userId);
    expect(memberships[0]?.status).toBe('active');
  });

  it('Caso A: a single disabled user produces a disabled identity and a disabled membership', async () => {
    const tenantId = await makeTenant('a-disabled');
    const email = `caso-a-disabled-${generateId()}@example.com`;
    const userId = await insertUser({ tenantId, email, passwordHash: 'hash', status: 'disabled' });

    await runBackfill();

    const identity = await findIdentityByEmail(email);
    expect(identity?.status).toBe('disabled');
    const memberships = await membershipsForIdentity(identity!.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.userId).toBe(userId);
    expect(memberships[0]?.status).toBe('disabled');
  });

  it('Caso B: the same normalized email in two tenants with the SAME hash consolidates into one active identity with two memberships', async () => {
    const tenantAId = await makeTenant('b-1');
    const tenantBId = await makeTenant('b-2');
    const localPart = `caso-b-${generateId()}`;
    const sharedHash = 'shared-hash-value';
    const userAId = await insertUser({ tenantId: tenantAId, email: `${localPart}@Example.com`, passwordHash: sharedHash });
    const userBId = await insertUser({ tenantId: tenantBId, email: `${localPart.toUpperCase()}@example.com`, passwordHash: sharedHash });

    await runBackfill();

    const identity = await findIdentityByEmail(`${localPart}@example.com`);
    expect(identity).toBeDefined();
    expect(identity?.status).toBe('active');
    expect(identity?.passwordHash).toBe(sharedHash);

    const memberships = await membershipsForIdentity(identity!.id);
    expect(memberships).toHaveLength(2);
    const userIds = memberships.map((m) => m.userId).sort();
    expect(userIds).toEqual([userAId, userBId].sort());
    const tenantIds = memberships.map((m) => m.tenantId).sort();
    expect(tenantIds).toEqual([tenantAId, tenantBId].sort());
  });

  it('Caso C: the same normalized email in two tenants with DIFFERENT hashes produces one pending_credential identity with a NULL password_hash, and both memberships are still created', async () => {
    const tenantAId = await makeTenant('c-1');
    const tenantBId = await makeTenant('c-2');
    const localPart = `caso-c-${generateId()}`;
    const userAId = await insertUser({ tenantId: tenantAId, email: `${localPart}@example.com`, passwordHash: 'hash-conflict-a' });
    const userBId = await insertUser({ tenantId: tenantBId, email: `${localPart}@example.com`, passwordHash: 'hash-conflict-b' });

    await runBackfill();

    const identity = await findIdentityByEmail(`${localPart}@example.com`);
    expect(identity).toBeDefined();
    expect(identity?.status).toBe('pending_credential');
    // Never an arbitrary pick between the two candidate hashes.
    expect(identity?.passwordHash).toBeNull();
    expect(identity?.passwordHash).not.toBe('hash-conflict-a');
    expect(identity?.passwordHash).not.toBe('hash-conflict-b');

    const memberships = await membershipsForIdentity(identity!.id);
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.userId).sort()).toEqual([userAId, userBId].sort());

    // The original per-tenant credentials are untouched — this migration never writes `users`.
    const { client, db } = getMigratorDb();
    try {
      const [userA] = await db.select().from(schema.users).where(eq(schema.users.id, userAId));
      const [userB] = await db.select().from(schema.users).where(eq(schema.users.id, userBId));
      expect(userA?.passwordHash).toBe('hash-conflict-a');
      expect(userB?.passwordHash).toBe('hash-conflict-b');
    } finally {
      await client.end();
    }
  });

  it('Caso D/E: an empty or structurally invalid email is excluded — no identity, no membership, the user row is untouched', async () => {
    const tenantId = await makeTenant('d-e');
    const emptyEmailUserId = await insertUser({ tenantId, email: '', passwordHash: 'hash-empty' });
    const invalidEmailUserId = await insertUser({ tenantId, email: 'not-an-email', passwordHash: 'hash-invalid' });

    await runBackfill();

    const { client, db } = getMigratorDb();
    try {
      const emptyMembership = await db
        .select()
        .from(schema.tenantMemberships)
        .where(eq(schema.tenantMemberships.userId, emptyEmailUserId));
      expect(emptyMembership).toHaveLength(0);

      const invalidMembership = await db
        .select()
        .from(schema.tenantMemberships)
        .where(eq(schema.tenantMemberships.userId, invalidEmailUserId));
      expect(invalidMembership).toHaveLength(0);

      // Untouched: both rows still exist exactly as inserted.
      const [emptyUser] = await db.select().from(schema.users).where(eq(schema.users.id, emptyEmailUserId));
      const [invalidUser] = await db.select().from(schema.users).where(eq(schema.users.id, invalidEmailUserId));
      expect(emptyUser?.email).toBe('');
      expect(emptyUser?.passwordHash).toBe('hash-empty');
      expect(invalidUser?.email).toBe('not-an-email');
      expect(invalidUser?.passwordHash).toBe('hash-invalid');
    } finally {
      await client.end();
    }
  });

  it('excludes soft-deleted users', async () => {
    const tenantId = await makeTenant('deleted');
    const email = `soft-deleted-${generateId()}@example.com`;
    const userId = await insertUser({ tenantId, email, passwordHash: 'hash', deletedAt: new Date() });

    await runBackfill();

    const identity = await findIdentityByEmail(email);
    expect(identity).toBeUndefined();

    const { client, db } = getMigratorDb();
    try {
      const memberships = await db.select().from(schema.tenantMemberships).where(eq(schema.tenantMemberships.userId, userId));
      expect(memberships).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('is idempotent: running the backfill twice does not duplicate identities or memberships', async () => {
    const tenantId = await makeTenant('idempotent');
    const email = `idempotent-${generateId()}@example.com`;
    const userId = await insertUser({ tenantId, email, passwordHash: 'hash' });

    await runBackfill();
    const identityAfterFirst = await findIdentityByEmail(email);
    const membershipsAfterFirst = await membershipsForIdentity(identityAfterFirst!.id);

    // A second run must be a safe no-op: same identity id, same single membership.
    await expect(runBackfill()).resolves.not.toThrow();

    const identityAfterSecond = await findIdentityByEmail(email);
    const membershipsAfterSecond = await membershipsForIdentity(identityAfterSecond!.id);

    expect(identityAfterSecond?.id).toBe(identityAfterFirst?.id);
    expect(membershipsAfterFirst).toHaveLength(1);
    expect(membershipsAfterSecond).toHaveLength(1);
    expect(membershipsAfterSecond[0]?.id).toBe(membershipsAfterFirst[0]?.id);
    expect(membershipsAfterSecond[0]?.userId).toBe(userId);
  });

  describe('roles and locations are unaffected by the backfill', () => {
    let tenantId: string;
    let userId: string;
    let roleId: string;
    let warehouseId: string;
    let locationId: string;

    beforeAll(async () => {
      tenantId = await makeTenant('roles-locations');
      userId = await insertUser({ tenantId, email: `roles-locations-${generateId()}@example.com`, passwordHash: 'hash' });

      const { client, db } = getMigratorDb();
      try {
        roleId = generateId();
        await db.insert(schema.roles).values({ id: roleId, tenantId, name: `Backfill Role ${generateId()}` });
        await db.insert(schema.userRoles).values({ tenantId, userId, roleId });

        warehouseId = generateId();
        await db.insert(schema.warehouses).values({ id: warehouseId, tenantId, name: 'Backfill WH', code: `BF-WH-${generateId()}` });
        locationId = generateId();
        await db.insert(schema.locations).values({ id: locationId, tenantId, warehouseId, name: 'Backfill Loc', code: `BF-LOC-${generateId()}` });
        await db.insert(schema.userLocationAssignments).values({ tenantId, userId, locationId });
      } finally {
        await client.end();
      }

      await runBackfill();
    });

    it('the user still has exactly its own role assignment', async () => {
      const { client, db } = getMigratorDb();
      try {
        const rows = await db
          .select()
          .from(schema.userRoles)
          .where(and(eq(schema.userRoles.tenantId, tenantId), eq(schema.userRoles.userId, userId)));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.roleId).toBe(roleId);
      } finally {
        await client.end();
      }
    });

    it('the user still has exactly its own location assignment', async () => {
      const { client, db } = getMigratorDb();
      try {
        const rows = await db
          .select()
          .from(schema.userLocationAssignments)
          .where(and(eq(schema.userLocationAssignments.tenantId, tenantId), eq(schema.userLocationAssignments.userId, userId)));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.locationId).toBe(locationId);
      } finally {
        await client.end();
      }
    });

    it('the user also got a membership, on top of (not instead of) its roles/locations', async () => {
      const { client, db } = getMigratorDb();
      try {
        const [membership] = await db.select().from(schema.tenantMemberships).where(eq(schema.tenantMemberships.userId, userId));
        expect(membership).toBeDefined();
        expect(membership?.tenantId).toBe(tenantId);
      } finally {
        await client.end();
      }
    });
  });
});
