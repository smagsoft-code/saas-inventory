import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_helpers';
import { platformAdmins, tenants } from './01-platform';
import { users } from './02-core';
import { identities } from './14-identity';

/**
 * TENANT ONBOARDING + TENANT SUPPORT (platform-ops block). Two **platform-scoped** tables — same
 * access-control-by-GRANT-only posture as `tenants` / `platform_admins` / `identities` /
 * `tenant_memberships` (ADR-0033) — **no RLS**, reachable only by `app_platform` (and
 * `app_migrator`). `app_tenant` gets no GRANT on either, so a tenant-scoped connection can never
 * enumerate invitations or support sessions.
 *
 * See ADR-0036 (SuperAdmin Tenant Onboarding + Tenant Support) for the full design rationale —
 * in particular why an invitation reuses `identities.status = 'pending_credential'` as the sole
 * login-blocking mechanism (no new "credential state" concept), and why a support session is a
 * DB-row-checked window keyed to (platform_admin_id, tenant_id) rather than a new token/cookie
 * type (it reuses the existing platform access token as its only auth transport).
 */

/**
 * A pending invitation for the tenant's admin (or any future SuperAdmin-provisioned user) to set
 * their own password. Created alongside a `pending_credential` identity — never alongside an
 * `active` one (an already-active identity needs no invitation, per ADR-0036 §5: reusing an
 * existing active identity for a new membership requires no credential step at all).
 */
export const tenantAdminInvitations = pgTable(
  'tenant_admin_invitations',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    identityId: uuid('identity_id').notNull(),
    /** The tenant-scoped profile row this invitation is provisioning access for. */
    userId: uuid('user_id').notNull(),
    /** HMAC-SHA256(raw token, JWT_REFRESH_SECRET) — same pepper/shape as
     * `RefreshTokenService`/`auth_refresh_tokens.token_hash`. The raw token is returned to the
     * caller exactly once (at creation/resend) and never stored. */
    tokenHash: text('token_hash').notNull(),
    /** `pending` — created, link not yet retrieved by the SuperAdmin. `sent` — the SuperAdmin has
     * retrieved/copied the link at least once (this system has no outbound email integration —
     * see ADR-0036 — so "sent" is recorded the moment the link is issued to the SuperAdmin, not a
     * delivery confirmation). `accepted` — the invitee set their password; terminal. `expired` —
     * `expires_at` has passed; derived at read time, never a cron-written value. `revoked` — a
     * SuperAdmin explicitly invalidated it before acceptance; terminal. */
    status: text('status').notNull().default('pending'),
    /** `platform_admins.id` of whoever created/last resent this invitation — soft reference (a
     * departed platform admin must never block reading who issued it), same convention as
     * `user_roles.assigned_by`. */
    createdBy: uuid('created_by'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'tenant_admin_invitations_tenant_fk',
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tenant_admin_invitations_identity_fk',
      columns: [t.identityId],
      foreignColumns: [identities.id],
    }).onDelete('restrict'),
    // Composite FK (ADR-0018 shape), same pattern as tenant_memberships_user_fk.
    foreignKey({
      name: 'tenant_admin_invitations_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    unique('tenant_admin_invitations_token_hash_key').on(t.tokenHash),
    index('tenant_admin_invitations_tenant_idx').on(t.tenantId),
    index('tenant_admin_invitations_identity_idx').on(t.identityId),
    // At most one LIVE invitation per user at a time (§5 of the prompt: "evitar múltiples
    // invitaciones simultáneamente válidas para el mismo onboarding") — resending supersedes the
    // previous row (marks it 'revoked') rather than leaving two valid tokens outstanding.
    uniqueIndex('tenant_admin_invitations_user_live_key')
      .on(t.userId)
      .where(sql`${t.status} IN ('pending', 'sent')`),
    check(
      'tenant_admin_invitations_status_check',
      sql`${t.status} IN ('pending', 'sent', 'accepted', 'expired', 'revoked')`,
    ),
  ],
);

/**
 * A temporary, tenant-scoped, audited window letting a Platform Admin read (and, in `write` mode,
 * perform a narrow, explicitly-allow-listed set of mutations on) one tenant's data for support —
 * without ever becoming a member of that tenant, without a tenant session, and without touching
 * the tenant admin's credentials (ADR-0036 §1's "no phantom admin" rule).
 *
 * Deliberately NOT a JWT/cookie of its own: the caller is still authenticated purely by their
 * existing platform access token (`platformPrincipal`); this table is what
 * `RequireSupportSession()` (a new guard, not `TenantGuard`) looks up, keyed by
 * `(platform_admin_id, tenant_id)`, to decide whether — and in which mode — that platform admin
 * may currently act on that one tenant. No new login, no new token type.
 */
export const platformSupportSessions = pgTable(
  'platform_support_sessions',
  {
    id: id(),
    platformAdminId: uuid('platform_admin_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    mode: text('mode').notNull(),
    /** Free-text justification — mandatory for `write` (enforced in the service, not the DB, since
     * `read` may also carry one but the schema doesn't need to distinguish that). Never a secret;
     * safe to show in the audit trail and in the frontend's "modo soporte" banner. */
    reason: text('reason').notNull(),
    /** `active` — currently usable (subject to `expires_at`). `ended` — explicitly closed by the
     * platform admin. `expired` — derived at read/guard time from `now() > expires_at`; the guard
     * treats a stale `active` row exactly like `expired` without needing a cron to flip it, but the
     * status is written back to `expired` on the next access attempt or explicit `GET .../current`
     * so the audit/UI never has to re-derive it. */
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'platform_support_sessions_admin_fk',
      columns: [t.platformAdminId],
      foreignColumns: [platformAdmins.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'platform_support_sessions_tenant_fk',
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
    }).onDelete('restrict'),
    index('platform_support_sessions_tenant_idx').on(t.tenantId),
    index('platform_support_sessions_admin_idx').on(t.platformAdminId),
    // At most one ACTIVE support session per platform admin (§17 of the prompt: no supporting two
    // tenants at once) — DB-enforced, not just an application-level "end the previous one" step.
    uniqueIndex('platform_support_sessions_admin_active_key').on(t.platformAdminId).where(sql`${t.status} = 'active'`),
    check('platform_support_sessions_mode_check', sql`${t.mode} IN ('read', 'write')`),
    check('platform_support_sessions_status_check', sql`${t.status} IN ('active', 'ended', 'expired')`),
  ],
);
