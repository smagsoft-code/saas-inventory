-- Step 1 of database.md#migration-strategy: extensions & roles.
--
-- Postgres roles, per database.md#row-level-security. RLS in Postgres is bypassed by the table
-- owner (and superusers) by default, so migrations run as a different role (app_migrator) than
-- the application, and the application itself uses more than one role so "who can see across
-- tenants" is a small, explicit, auditable set of connections rather than a flag inside the app.
--
-- Bootstrap requirement: THIS FILE must be applied by a connection with CREATEROLE (and
-- CREATEDB-owner-equivalent) privileges on the target database — e.g. the database's initial
-- owner role (docker-compose.dev.yml's POSTGRES_USER in local/dev). Every later migration file
-- runs in the same session, after this file's `SET ROLE app_migrator`, so app_migrator ends up
-- owning every table this migration sequence creates (see src/database/migrate.ts, which runs
-- the whole batch over one persistent connection so SET ROLE — session-scoped, unlike SET
-- LOCAL — carries through). CREATE ROLE is written idempotently (IF NOT EXISTS) so re-running
-- this bootstrap against an already-provisioned database is a safe no-op.
--
-- Real login passwords are provisioned out-of-band per environment (ALTER ROLE ... WITH
-- PASSWORD, or an equivalent managed-Postgres mechanism) — never committed to a migration file,
-- per CLAUDE.md §7.4 and security.md#secrets-management.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator WITH LOGIN;
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant WITH LOGIN;
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform WITH LOGIN BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_event_processor') THEN
    CREATE ROLE app_event_processor WITH LOGIN;
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_public_resolver') THEN
    CREATE ROLE app_public_resolver WITH LOGIN;
  END IF;
END
$$;
--> statement-breakpoint

-- pgcrypto: only used for gen_random_uuid()'s fallback DEFAULT (ADR-0016) — the primary id
-- generation path is application-side UUIDv7 (packages/shared's generateId()). Created by the
-- bootstrap role, before the role switch below, since a freshly-created app_migrator has no
-- CREATE-extension privilege of its own yet.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- The bootstrap role just created app_migrator, so it automatically holds ADMIN OPTION on it —
-- this GRANT lets the *current* bootstrap login (whatever it's named per environment) SET ROLE
-- to app_migrator without needing that membership pre-provisioned by infra.
DO $$
BEGIN
  EXECUTE format('GRANT app_migrator TO %I', session_user);
END
$$;
--> statement-breakpoint

ALTER SCHEMA public OWNER TO app_migrator;
--> statement-breakpoint

-- Drizzle Kit's own bookkeeping schema/table (drizzle.__drizzle_migrations) is created by the
-- migrator runtime itself, owned by the bootstrap role, BEFORE this file's statements run — and
-- crucially, drizzle-orm's postgres-js migrator wraps every pending migration file's statements
-- AND its own tracking-row INSERT into that table in one single transaction (see
-- PgDialect.migrate in drizzle-orm/pg-core/dialect.js). Without this GRANT, the moment SET ROLE
-- app_migrator below takes effect, drizzle's post-migration INSERT into drizzle.__drizzle_migrations
-- fails with "permission denied for schema drizzle" — and because it's the same transaction, that
-- failure silently rolls back EVERYTHING this file (and every other pending file batched with it)
-- just did, including the CREATE ROLE statements above. Discovered by running this migration
-- against a real PostgreSQL instance (PROMPT 03-A) — Drizzle Kit's own migration-tracking table
-- was never accounted for by the original design, since it is not one of this project's own
-- tables and does not appear in the TypeScript schema.
GRANT ALL ON SCHEMA drizzle TO app_migrator;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA drizzle TO app_migrator;
--> statement-breakpoint
GRANT ALL ON ALL SEQUENCES IN SCHEMA drizzle TO app_migrator;
--> statement-breakpoint

-- From here on — for the rest of this file AND every later migration file applied in the same
-- session (see src/database/migrate.ts) — the current role is app_migrator, so every object
-- created from this point is owned by app_migrator.
SET ROLE app_migrator;
--> statement-breakpoint

-- Shared trigger functions, attached per-table in every migration that creates a mutable /
-- tenant-owned table — see database.md#constraints's "Trigger-enforced invariants". Both are
-- SECURITY INVOKER (the default — no SECURITY DEFINER, per security.md's "not used
-- unnecessarily" guidance) since neither queries another table, only NEW/OLD.

CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- IS DISTINCT FROM (not <>) so this also catches a NULL -> non-NULL / non-NULL -> NULL change on
-- the two mixed-scope tables (audit_log, event_outbox) — <> would silently pass when either side
-- is NULL. TG_TABLE_NAME only (not OLD.id) since several tenant-owned tables this trigger attaches
-- to have a composite primary key, not a plain `id` column (role_permissions, user_roles,
-- category_attributes).
CREATE FUNCTION prevent_tenant_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot be changed after insert (table: %)', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
