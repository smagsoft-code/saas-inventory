import { foreignKey, index, inet, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { tenants } from './01-platform';
import { users } from './02-core';

/**
 * AUTH — server-side refresh-token store, Prompt 04 (docs/architecture/security.md#authentication).
 * Access tokens are stateless JWTs (not persisted); refresh tokens are opaque, tracked here so a
 * specific session can be revoked (logout, "log out everywhere", rotation-reuse detection) per
 * the threat model's "Stolen / replayed JWT" mitigation. Tenant-owned, RLS-enabled, following the
 * exact tenant_isolation shape as every other CORE table — see database.md#row-level-security.
 *
 * Only tenant users authenticate through this table in this phase — platform_admins have no login
 * endpoint yet (not requested), so tenantId/userId are NOT NULL here, unlike audit_log's
 * deliberately mixed-scope shape. A future platform_admin auth pass adds its own table/migration
 * rather than retrofitting nullability onto this one.
 */

export const authRefreshTokens = pgTable('auth_refresh_tokens', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  /** SHA-256 hex digest of the opaque token — the raw token is never stored, only ever returned
   * once (in the httpOnly cookie) at issuance/rotation time. */
  tokenHash: text('token_hash').notNull(),
  /** Soft reference to this table's own id — the token this row replaced on rotation. Not
   * FK-constrained, same convention as user_roles.assigned_by: a chain link is informational
   * (reuse detection), never something that should block a row from existing. */
  rotatedFromId: uuid('rotated_from_id'),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ipAddress: inet('ip_address'),
}, (t) => [
  foreignKey({ name: 'auth_refresh_tokens_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  foreignKey({
    name: 'auth_refresh_tokens_user_fk',
    columns: [t.tenantId, t.userId],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('auth_refresh_tokens_tenant_id_id_key').on(t.tenantId, t.id),
  unique('auth_refresh_tokens_token_hash_key').on(t.tokenHash),
  index('auth_refresh_tokens_tenant_user_idx').on(t.tenantId, t.userId),
  index('auth_refresh_tokens_tenant_expires_idx').on(t.tenantId, t.expiresAt),
  tenantIsolationPolicy('auth_refresh_tokens'),
]).enableRLS();
