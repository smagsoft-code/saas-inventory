-- FASE 10 (roadmap.md) / ADR-0029 — the Import Worker deployable needs its own Postgres role,
-- the same shape as app_event_processor's relationship to event_outbox (migration 0010): subject
-- to RLS, but granted one permissive, table-scoped policy per table it claims/updates across every
-- tenant in one query. Migration 0000 (Prompt 03) predates ADR-0027/ADR-0029 and therefore never
-- created this role — an applied migration is never edited (CLAUDE.md §7.7), so it is created here
-- instead, following migration 0000's own idempotent CREATE ROLE style.
--
-- RESET ROLE is required first: migration 0000 already switched this session to app_migrator
-- (src/database/migrate.ts's whole point — one persistent connection for the entire batch, SET
-- ROLE is session-scoped so it carries through every later migration file), and app_migrator has
-- no CREATEROLE of its own (by design — see migration 0000's own header). RESET ROLE restores the
-- session's originally-authenticated identity (MIGRATOR_DATABASE_URL's login, which migration
-- 0000's own header requires to have CREATEROLE) just long enough to create this one role, then
-- SET ROLE app_migrator puts the session straight back so every statement after this one in this
-- migration (and every later migration file in the batch) keeps app_migrator's expected ownership
-- — confirmed necessary by running this migration for real against PostgreSQL (`permission denied
-- to create role` without it — tools/pg-verify).
RESET ROLE;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_import_worker') THEN
    CREATE ROLE app_import_worker WITH LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
SET ROLE app_migrator;
--> statement-breakpoint

CREATE POLICY "import_job_rows_import_worker_access" ON "import_job_rows" AS PERMISSIVE FOR ALL TO "app_import_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "import_jobs_import_worker_access" ON "import_jobs" AS PERMISSIVE FOR ALL TO "app_import_worker" USING (true) WITH CHECK (true);
--> statement-breakpoint

-- The worker claims a job (SELECT ... FOR UPDATE SKIP LOCKED, then UPDATE status/progress/
-- started_at/completed_at) and updates row-level status/errors/warnings as it validates/commits
-- batches — never DELETE, same retention posture as event_outbox's app_event_processor grant
-- (migration 0010). The worker never touches import_mapping_templates (it only ever reads
-- import_jobs.column_mapping, already a frozen copy) or any CATALOG/INVENTORY table over this
-- connection — those writes happen over a normal, per-tenant app_tenant connection once a job is
-- claimed (database.md#large-imports), so this role's blast radius stays exactly these two tables.
GRANT SELECT, UPDATE ON import_job_rows TO app_import_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE ON import_jobs TO app_import_worker;
