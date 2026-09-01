import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, updatedAt } from './_helpers';
import { tenants } from './01-platform';
import { users } from './02-core';

/**
 * GLOBAL IDENTITY + TENANT MEMBERSHIPS — ADR-0033,
 * database.md#global-identity-and-tenant-memberships.
 *
 * Two **platform-scoped** tables (`identities` has no tenant dimension at all; `tenant_memberships`
 * carries `tenant_id` only as a foreign key, never as an RLS key), following the exact
 * access-control-by-GRANT-only posture of `tenants` / `platform_admins` /
 * `platform_admin_refresh_tokens` — **no RLS**, reachable only by `app_platform` (and
 * `app_migrator` for schema/backfill). `app_tenant` gets **no GRANT at all**, so a tenant-scoped
 * request can never enumerate identities or memberships (multi-tenancy.md's "a tenant connection
 * never lists across tenants" invariant).
 *
 * Scope of 016-B: the database layer only. The email+password authentication flow, tenant
 * selection, `switch-tenant` and the JWT changes are a **later, separate prompt** — nothing here
 * touches `auth.service.ts`, the guards, the JWT, RLS or the frontend. `users` (schema and data,
 * including `password_hash`) is left completely untouched; migration `0029` only *reads* it to
 * backfill these two tables. The current `tenantSlug`-based login keeps working unchanged,
 * unaware this migration ran. Nothing yet reads `identities.password_hash`.
 */

/**
 * The person, globally — one row per human, one authentication credential. The tenant-scoped
 * `users` row(s) remain their per-company profile; `tenant_memberships` is the bridge.
 */
export const identities = pgTable(
  'identities',
  {
    id: id(),
    /** Stored already-normalized (trim + lowercase — the existing `normalizeEmail()` convention,
     * `auth/util/normalize.ts`). Global uniqueness is enforced case-insensitively by
     * `identities_email_lower_key` below: `Juan@Gmail.com` and `juan@gmail.com` resolve to the
     * same identity. No second normalization scheme is introduced. */
    email: text('email').notNull(),
    /** The single authentication credential (Argon2id), shared across every tenant this identity
     * belongs to. NULL **only** while `status = 'pending_credential'` (see the CHECK below and
     * migration `0029`'s divergent-hash handling). The current login does not read this column —
     * it still reads `users.password_hash` until the auth rewrite. */
    passwordHash: text('password_hash'),
    /** `active` — may authenticate once the new flow exists. `pending_credential` — the identity
     * exists but has no consolidated credential yet (migration `0029` found two different
     * `users.password_hash` values for one email and refused to pick one); the person must set a
     * single password before the new auth flow accepts them — that flow, and any reset UI, is a
     * later prompt. `disabled` — blocked globally, every tenant. */
    status: text('status').notNull().default('active'),
    /** Canonical display name. Each `users` row keeps its own per-tenant `full_name`; this is the
     * identity-level fallback. */
    fullName: text('full_name').notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Case-insensitive global uniqueness — the single email-normalization strategy.
    uniqueIndex('identities_email_lower_key').on(sql`lower(${t.email})`),
    check('identities_status_check', sql`${t.status} IN ('active', 'pending_credential', 'disabled')`),
    // Credential integrity: an `active` or `disabled` identity must carry a credential; only
    // `pending_credential` may have a NULL `password_hash`. Stops any code path from ever
    // "activating" an identity that has no password.
    check(
      'identities_credential_check',
      sql`${t.passwordHash} IS NOT NULL OR ${t.status} = 'pending_credential'`,
    ),
  ],
);

/**
 * identity ↔ tenant. Carries `user_id` so every existing tenant-scoped relation (`user_roles`,
 * `user_location_assignments`, `auth_refresh_tokens`, `audit_log.actor_id`, and every business FK)
 * stays keyed by `users.id`, unchanged — 016-A's explicit decision (no mass `user_id` →
 * `identity_id` migration).
 */
export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: id(),
    identityId: uuid('identity_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    /** The tenant-scoped profile row for this identity in this tenant. 1:1 with the membership. */
    userId: uuid('user_id').notNull(),
    /** `active` — this identity may operate in this tenant. `disabled` — access revoked for this
     * one tenant, without touching the identity's other memberships. */
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'tenant_memberships_identity_fk',
      columns: [t.identityId],
      foreignColumns: [identities.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tenant_memberships_tenant_fk',
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
    }).onDelete('restrict'),
    // Composite FK (ADR-0018 shape): guarantees the membership's `tenant_id` matches the
    // referenced user's `tenant_id` — a membership can never point at a `users` row belonging to a
    // different tenant. Target is `users_tenant_id_id_key` (migration 0002).
    foreignKey({
      name: 'tenant_memberships_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    // One membership per (identity, tenant).
    unique('tenant_memberships_identity_id_tenant_id_key').on(t.identityId, t.tenantId),
    // Each `users` profile row belongs to exactly one identity (1:1 with the membership).
    unique('tenant_memberships_user_id_key').on(t.userId),
    index('tenant_memberships_identity_idx').on(t.identityId),
    index('tenant_memberships_tenant_idx').on(t.tenantId),
    check('tenant_memberships_status_check', sql`${t.status} IN ('active', 'disabled')`),
  ],
);
