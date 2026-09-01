-- Backfill (016-B / ADR-0033): consolidate every existing tenant-scoped `users` row into the new
-- global `identities` + `tenant_memberships` tables, grouped by NORMALIZED email (lower + trim) —
-- never by tenant. Deterministic, additive, never destructive, never picks a password
-- arbitrarily. `users` (including `users.password_hash`) is never modified by this file — the
-- current tenantSlug-based login is completely unaffected and keeps reading `users.password_hash`
-- exactly as before.
--
-- Rules (see database.md#global-identity-and-tenant-memberships and this migration's own
-- comments below for the exact SQL):
--   Caso A — one users row for a normalized email -> 1 identity, 1 membership, that row's own
--            password_hash, status 'active' (or 'disabled' if that one row is 'disabled').
--   Caso B — several users rows share a normalized email AND the SAME password_hash -> 1
--            identity carrying that one hash, N memberships, status 'active' unless every row is
--            'disabled'.
--   Caso C — several users rows share a normalized email but have DIFFERENT password_hash values
--            -> 1 identity, password_hash NULL, status 'pending_credential' (never a pick between
--            the candidates), N memberships still created (access itself is not revoked — only
--            the *new* auth flow, a later prompt, will refuse to authenticate a
--            'pending_credential' identity until a single password is set).
--   Caso D/E — empty, blank, or structurally invalid email (no '@') -> excluded entirely: no
--            identity, no membership, `users` row left completely untouched. This should not
--            occur in practice (LoginDto/CreateUserDto/RegisterDto all validate with @IsEmail());
--            guarded here rather than assumed. See database/scripts/report-identity-backfill.sql
--            to surface any such rows for operator review after migrating.
--   Soft-deleted users (`deleted_at IS NOT NULL`) are excluded the same way — already logically
--            gone; nothing invents an identity for them.
--
-- Idempotent: the identities INSERT targets `ON CONFLICT (lower(email))` (migration 0028's
-- unique index). The tenant_memberships INSERT additionally pre-filters out any user that already
-- has a membership (`tenant_memberships_user_id_key` allows at most one, ever — checked via
-- NOT EXISTS, not relied on as the only guard) and falls back to a bare `ON CONFLICT DO NOTHING`
-- (matches either of its two unique constraints) as a last-resort guard against a concurrent
-- session backfilling the same row at the same time. So re-running this file, or re-running
-- `db:migrate` against an already-migrated database (drizzle skips already-applied files; this is
-- what protects a manual re-run of the same SQL), inserts nothing new and changes nothing.
--
-- RLS note: `users` has ENABLE + FORCE ROW LEVEL SECURITY (migration 0002) with its only policy
-- `TO app_tenant`. app_migrator (the role this whole migration sequence runs as, and the owner of
-- `users`) does NOT match that policy, and FORCE means table ownership alone does not bypass it —
-- so without the toggle below this file would see zero `users` rows. Toggling FORCE off for the
-- duration of the two statements below is safe: everything in this file runs inside the single
-- transaction Drizzle wraps the whole migration file in (see migration 0000's header comment), so
-- no other session ever observes the intermediate state, and FORCE is unconditionally restored
-- before this transaction commits — verified by
-- test/database/migrations.integration.test.ts's RLS-coverage check ("every tenant-owned table
-- has ... FORCE RLS").
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

WITH candidate_users AS (
	SELECT
		id,
		tenant_id,
		lower(trim(email)) AS norm_email,
		password_hash,
		full_name,
		status,
		created_at,
		last_login_at
	FROM users
	WHERE deleted_at IS NULL
		AND trim(email) <> ''
		AND position('@' IN email) > 1
),
grouped AS (
	SELECT
		norm_email,
		count(DISTINCT password_hash) AS distinct_hash_count,
		-- Tie-break for DISPLAY fields only (full_name), and for password_hash ONLY in the
		-- single-hash case where every candidate row already agrees on it (distinct_hash_count = 1
		-- makes rep_password_hash unambiguous — there is only one distinct value to pick from, this
		-- is not a choice between competing passwords). Most-recently-active row wins, falling back
		-- to the earliest-created row.
		(array_agg(password_hash ORDER BY last_login_at DESC NULLS LAST, created_at ASC))[1] AS rep_password_hash,
		(array_agg(full_name ORDER BY last_login_at DESC NULLS LAST, created_at ASC))[1] AS rep_full_name,
		min(created_at) AS first_created_at,
		bool_and(status = 'disabled') AS all_disabled
	FROM candidate_users
	GROUP BY norm_email
)
INSERT INTO identities (id, email, password_hash, status, full_name, created_at, updated_at)
SELECT
	gen_random_uuid(),
	g.norm_email,
	CASE WHEN g.distinct_hash_count = 1 THEN g.rep_password_hash ELSE NULL END,
	CASE
		WHEN g.distinct_hash_count > 1 THEN 'pending_credential'
		WHEN g.all_disabled THEN 'disabled'
		ELSE 'active'
	END,
	g.rep_full_name,
	g.first_created_at,
	now()
FROM grouped g
ON CONFLICT (lower(email)) DO NOTHING;
--> statement-breakpoint

INSERT INTO tenant_memberships (id, identity_id, tenant_id, user_id, status, created_at, updated_at)
SELECT
	gen_random_uuid(),
	i.id,
	u.tenant_id,
	u.id,
	CASE WHEN u.status = 'disabled' THEN 'disabled' ELSE 'active' END,
	u.created_at,
	now()
FROM users u
-- lower() on both sides, not just u.email: identities.email is always stored already-normalized
-- by this file's own INSERT above, but this JOIN must not silently stop matching if some other
-- writer ever inserts an identities row with different casing.
JOIN identities i ON lower(i.email) = lower(trim(u.email))
WHERE u.deleted_at IS NULL
	AND trim(u.email) <> ''
	AND position('@' IN u.email) > 1
	-- Every users row gets AT MOST one membership, ever (tenant_memberships_user_id_key). Skipping
	-- a user that already has one — regardless of which identity_id it resolved to on an earlier
	-- run — makes this idempotent under concurrent modification of `users` by other sessions, not
	-- only under a byte-identical re-run.
	AND NOT EXISTS (SELECT 1 FROM tenant_memberships tm WHERE tm.user_id = u.id)
-- No conflict target: a concurrent session backfilling the same row between this statement's
-- NOT EXISTS check and its INSERT would otherwise raise, on either tenant_memberships_user_id_key
-- or tenant_memberships_identity_id_tenant_id_key — DO NOTHING (any arbiter) makes that a no-op.
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE users FORCE ROW LEVEL SECURITY;
