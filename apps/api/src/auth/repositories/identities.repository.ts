import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { identities } from '../../database/schema';

export interface IdentityRow {
  id: string;
  email: string;
  passwordHash: string | null;
  status: string;
  fullName: string;
  createdAt: Date;
}

/**
 * The one repository touching `identities` (016-B / ADR-0033) — the global, per-person record that
 * owns the single authentication credential. Platform-scoped (no RLS, no `app_tenant` grant), so
 * every method runs on the `app_platform` connection, exactly like `PlatformAdminsRepository` and
 * `TenantsPlatformRepository`.
 *
 * Email is matched case-insensitively via the `identities_email_lower_key` functional unique index
 * — the caller still passes an already-`normalizeEmail()`-d value (the one normalization strategy,
 * `auth/util/normalize.ts`); `lower()` here is the DB-level backstop that keeps the lookup correct
 * even if an identity row were ever written with different casing.
 */
@Injectable()
export class IdentitiesRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async findByEmail(email: string): Promise<IdentityRow | undefined> {
    const [row] = await this.platformDb
      .select()
      .from(identities)
      .where(sql`lower(${identities.email}) = lower(${email})`);
    return row;
  }

  async findById(id: string): Promise<IdentityRow | undefined> {
    const [row] = await this.platformDb.select().from(identities).where(eq(identities.id, id));
    return row;
  }

  /**
   * Find-or-create by normalized email. Never overwrites an existing identity's credential — the
   * password belongs to the person, not to whichever tenant just added them (`ON CONFLICT
   * (lower(email)) DO NOTHING`, same idempotency the 016-B backfill uses). Returns the resulting
   * identity row (the pre-existing one on conflict, the newly inserted one otherwise).
   */
  async findOrCreate(values: { id: string; email: string; passwordHash: string; fullName: string }): Promise<IdentityRow> {
    // Bare ON CONFLICT DO NOTHING (any arbiter): the only unique constraint that can be hit is the
    // `lower(email)` functional index (the `id` is freshly generated, never a PK clash). Drizzle's
    // typed `target` cannot express a functional index, and it does not need to here.
    await this.platformDb
      .insert(identities)
      .values({ id: values.id, email: values.email, passwordHash: values.passwordHash, status: 'active', fullName: values.fullName })
      .onConflictDoNothing();
    const existing = await this.findByEmail(values.email);
    if (!existing) {
      throw new Error('Identity find-or-create returned no row.');
    }
    return existing;
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.platformDb.update(identities).set({ lastLoginAt: new Date() }).where(eq(identities.id, id));
  }

  /**
   * Find-or-create for the SuperAdmin onboarding path (ADR-0036) — no password is supplied at
   * this point (the admin sets their own via the invitation, §5). A NEW identity is inserted as
   * `pending_credential` with a NULL credential, satisfying `identities_credential_check` exactly
   * the way migration 0029's divergent-hash backfill already does. Same `ON CONFLICT (lower(email))
   * DO NOTHING` idempotency as `findOrCreate` — an existing identity (whatever its status) is
   * returned as-is, never overwritten; the caller decides what to do based on the returned status
   * (ADR-0036 §4: active → no invitation needed; pending_credential → an invitation resolves it
   * too; disabled → the caller must refuse, never silently provision an unreachable admin).
   */
  async findOrCreatePending(values: { id: string; email: string; fullName: string }): Promise<IdentityRow> {
    await this.platformDb
      .insert(identities)
      .values({ id: values.id, email: values.email, passwordHash: null, status: 'pending_credential', fullName: values.fullName })
      .onConflictDoNothing();
    const existing = await this.findByEmail(values.email);
    if (!existing) {
      throw new Error('Identity find-or-create (pending) returned no row.');
    }
    return existing;
  }

  /** Sets the identity's single global credential and activates it — the one write the accept-
   * invitation flow performs. Conditional on still being `pending_credential` (a CAS, not a blind
   * UPDATE): a concurrent accept of the same invitation, or an identity that became `active`/
   * `disabled` through another path in between, must not silently overwrite a credential that is
   * no longer pending. Returns the updated row, or `undefined` if the CAS didn't match. */
  async activateCredential(id: string, passwordHash: string): Promise<IdentityRow | undefined> {
    const [row] = await this.platformDb
      .update(identities)
      .set({ passwordHash, status: 'active' })
      .where(sql`${identities.id} = ${id} AND ${identities.status} = 'pending_credential'`)
      .returning();
    return row;
  }
}
