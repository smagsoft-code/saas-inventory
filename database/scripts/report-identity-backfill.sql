-- Read-only report for reviewing the 016-B / ADR-0033 identities backfill (migration 0029)
-- against a real environment with existing data. NEVER modifies anything — every statement below
-- is a SELECT. Run as app_platform (it already has SELECT + BYPASSRLS on every table this touches
-- — no elevated access is granted for this script):
--
--   psql "$APP_PLATFORM_DATABASE_URL" -f database/scripts/report-identity-backfill.sql
--
-- Sections, in order:
--   1. Summary counts (users / identities by status / memberships by status).
--   2. Identities left `pending_credential` (Caso C — divergent password_hash values for one
--      normalized email; the backfill never picked one) — internal ids only, never a password.
--   3. `users` rows the backfill could not attach to any identity (Caso D/E — empty or
--      structurally invalid email). Expected to be empty: LoginDto/CreateUserDto/RegisterDto all
--      validate email with `@IsEmail()`.
--   4. Structural consistency: every eligible user has exactly one membership, and no membership
--      is orphaned.

\echo '--- 1. Summary ---'
SELECT
  (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS users_total,
  (SELECT count(*) FROM identities) AS identities_total,
  (SELECT count(*) FROM identities WHERE status = 'active') AS identities_active,
  (SELECT count(*) FROM identities WHERE status = 'pending_credential') AS identities_pending_credential,
  (SELECT count(*) FROM identities WHERE status = 'disabled') AS identities_disabled,
  (SELECT count(*) FROM tenant_memberships) AS memberships_total,
  (SELECT count(*) FROM tenant_memberships WHERE status = 'active') AS memberships_active,
  (SELECT count(*) FROM tenant_memberships WHERE status = 'disabled') AS memberships_disabled;

\echo '--- 2. Identities pending a consolidated credential (Caso C) — internal ids only, no password shown ---'
SELECT
  i.id AS identity_id,
  i.email,
  count(tm.id) AS membership_count,
  array_agg(tm.tenant_id ORDER BY tm.tenant_id) AS tenant_ids,
  array_agg(tm.user_id ORDER BY tm.user_id) AS user_ids
FROM identities i
JOIN tenant_memberships tm ON tm.identity_id = i.id
WHERE i.status = 'pending_credential'
GROUP BY i.id, i.email
ORDER BY i.created_at;

\echo '--- 3. users rows excluded by the backfill (empty/invalid email) — expected: none ---'
SELECT id AS user_id, tenant_id, email, status, created_at
FROM users
WHERE deleted_at IS NULL
  AND (trim(email) = '' OR position('@' IN email) <= 1)
ORDER BY created_at;

\echo '--- 4. Consistency: every eligible user has exactly one membership; no orphaned membership ---'
SELECT
  (SELECT count(*)
     FROM users u
     WHERE u.deleted_at IS NULL
       AND trim(u.email) <> ''
       AND position('@' IN u.email) > 1
       AND NOT EXISTS (SELECT 1 FROM tenant_memberships tm WHERE tm.user_id = u.id)
  ) AS eligible_users_missing_a_membership,
  (SELECT count(*)
     FROM tenant_memberships tm
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = tm.user_id)
  ) AS orphaned_memberships;
