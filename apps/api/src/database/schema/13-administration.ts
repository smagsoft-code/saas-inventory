import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, inet, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, updatedAt } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { platformAdmins, tenants } from './01-platform';

/**
 * ADMINISTRATION — modules.md#administration ("tenant-level configuration ... and system-level
 * configuration that only a SuperAdmin can change"), FASE 11. Two tables, two different scopes:
 *
 * - `tenant_settings`: tenant-owned, RLS-enabled, one singleton row per tenant (same "mutable
 *   config, never deleted" shape as `tenant_price_policies` — database.md's data-lifecycle table).
 *   Only `business_hours`/`timezone` are modeled here — the only two examples modules.md names
 *   that are not explicitly deferred elsewhere: `branding` is named "later" in modules.md itself,
 *   and per-tenant `notification_preferences`' exact mechanism is an explicit `PENDING DECISION`
 *   "made when tenant-configurable notifications are actually built" (events.md#n8n-and-telegram)
 *   — i.e. FASE 15, not this phase.
 * - `platform_admin_refresh_tokens`: platform-scoped (no `tenant_id`, no RLS — same access-control-
 *   by-GRANT-only posture as `platform_admins` itself, database.md#row-level-security), the
 *   server-side session store for the SuperAdmin login this phase adds — see
 *   `auth/repositories/platform-admins.repository.ts` and `12-auth.ts`'s own header comment: "A
 *   future platform_admin auth pass adds its own table/migration rather than retrofitting
 *   nullability onto [auth_refresh_tokens]." This is that pass.
 */

export const tenantSettings = pgTable('tenant_settings', {
  id: id(),
  tenantId: tenantId(),
  /** IANA timezone name (e.g. `America/Bogota`), validated against `Intl.supportedValuesOf`
   * server-side (administration/dto) — needed to interpret `businessHours`. */
  timezone: text('timezone').notNull().default('UTC'),
  /** Array of `{ dayOfWeek: 0-6, isClosed, opensAt: "HH:mm", closesAt: "HH:mm" }` entries,
   * validated by DTO (class-validator, one entry per weekday, no arbitrary keys) — a governed
   * shape, not an open key/value settings bag, per CLAUDE.md's "no crear un sistema paralelo"
   * posture applied to configuration modeling. Defaults to `[]` (no hours configured — the
   * effective-value resolution in tenant-settings.service.ts treats this as "unrestricted"). */
  businessHours: jsonb('business_hours').notNull().default([]),
  /** Transferencias workflow config (F17-TRANSFERS-AUDIT §1) — which of the two *gate* stages
   * (`approved`, `preparing`) a transfer must pass through a manual action to reach, vs. skip
   * straight through automatically. `dispatched`/`received` are NEVER skippable — they are the
   * physical events themselves (stock actually leaving/arriving), not gates in front of one.
   * Defaults `true`/`true` — every existing/new tenant keeps today's full
   * draft→approved→preparing→dispatched→received flow unless an admin explicitly turns a gate off.
   * See `transfers.service.ts`'s `advanceThroughDisabledStages` for how a disabled gate is
   * actually skipped (the underlying approve()/prepare() mechanics — reservation, audit, the
   * lockById row-lock — are reused verbatim, never duplicated or changed). */
  transfersRequireApproval: boolean('transfers_require_approval').notNull().default(true),
  transfersRequirePreparation: boolean('transfers_require_preparation').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ name: 'tenant_settings_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('tenant_settings_tenant_id_key').on(t.tenantId),
  // ADR-0018's universal tenant-aware composite-FK-target convention, applied even though nothing
  // currently composite-FKs into tenant_settings — database.md#tenant-aware-referential-integrity
  // fixes this as a property of every NOT-NULL-tenant_id table, not something added only once a
  // consumer exists (confirmed against the live schema by
  // test/database/migrations.integration.test.ts's "every tenant-owned table has the
  // tenant-aware UNIQUE (tenant_id, id)..." coverage check).
  unique('tenant_settings_tenant_id_id_key').on(t.tenantId, t.id),
  tenantIsolationPolicy('tenant_settings'),
]).enableRLS();

/**
 * The company logo shown in the app shell (owner request) — at most one per tenant. Its own small
 * table rather than columns on `tenant_settings`: that table is a lazily-created singleton upserted
 * wholesale by every settings PATCH, and a logo has a different lifecycle (uploaded/removed on its
 * own, bytes live in object storage like `product_images`; only the pointer + mime type are here).
 * Replaced or removed by uploading/deleting — the storage object is deleted best-effort.
 */
export const tenantLogos = pgTable('tenant_logos', {
  id: id(),
  tenantId: tenantId(),
  /** Opaque pointer into `ObjectStorageService`'s bucket, never returned to a client. */
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'tenant_logos_tenant_fk',
    columns: [t.tenantId],
    foreignColumns: [tenants.id],
  }).onDelete('restrict'),
  unique('tenant_logos_tenant_id_key').on(t.tenantId),
  unique('tenant_logos_tenant_id_id_key').on(t.tenantId, t.id),
  check('tenant_logos_mime_type_check', sql`${t.mimeType} IN ('image/jpeg', 'image/png', 'image/webp')`),
  tenantIsolationPolicy('tenant_logos'),
]).enableRLS();

export const platformAdminRefreshTokens = pgTable('platform_admin_refresh_tokens', {
  id: id(),
  platformAdminId: uuid('platform_admin_id').notNull(),
  /** Same HMAC-SHA256(token, JWT_REFRESH_SECRET) scheme as `auth_refresh_tokens.token_hash` —
   * reuses the existing `RefreshTokenService`, not a second hashing scheme. */
  tokenHash: text('token_hash').notNull(),
  rotatedFromId: uuid('rotated_from_id'),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ipAddress: inet('ip_address'),
}, (t) => [
  foreignKey({
    name: 'platform_admin_refresh_tokens_admin_fk',
    columns: [t.platformAdminId],
    foreignColumns: [platformAdmins.id],
  }).onDelete('restrict'),
  unique('platform_admin_refresh_tokens_token_hash_key').on(t.tokenHash),
  index('platform_admin_refresh_tokens_admin_idx').on(t.platformAdminId),
]);
