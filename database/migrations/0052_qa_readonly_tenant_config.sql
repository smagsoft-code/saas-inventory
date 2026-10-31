-- D-8E.26-B4.11.3 — pins the scope of `app_qa_readonly` to an immutable tenant UUID held in a protected, EMPTY-BY-DEFAULT configuration table, instead of to the
-- mutable slug `qa-dev-tenant` that 0051 resolved. PREPARED, NOT APPLIED to any database. 0051 is history and is not edited: this migration replaces the two views.
--
-- WHY: the slug is a mutable attribute of `tenants`. Whoever can write `tenants.slug` (a platform admin, a superuser — never the QA role) could re-point the role
-- at another company by renaming two rows (the "KNOWN PROPERTY" test of B4.11). The UUID in a table nobody but a privileged operator can write cannot be redirected
-- by renaming, re-slugging or suspending/reactivating any tenant.
--
-- THE TABLE: a singleton (primary key `singleton boolean` constrained to true, so at most one row). It is created EMPTY and nothing here inserts into it: no default
-- value, no lookup by slug or name, no assumption that a QA tenant exists. While it is empty both views return no row and the role reads nothing (fail closed).
-- The column is called `authorized_tenant_id`, not `tenant_id`: it is not tenant-owned data (it is configuration ABOUT which tenant a role may read), and the
-- repository's tenant-table checks key on the `tenant_id` column. No RLS: access is by GRANT alone, like `tenants` / `platform_admins` — NO role gets any privilege on it
-- (the project has no default privileges, `pg_default_acl` is empty), so `app_tenant`, `app_platform`, `app_import_worker`, `app_event_processor`, `app_public_resolver`
-- and `app_qa_readonly` cannot read or write it. Only its owner (app_migrator, the project's DDL identity) and superusers can touch it, and even the owner has its
-- write privileges REVOKEd below, so a later migration or a stray session as app_migrator cannot change the scope by accident; the deliberate path is the privileged
-- procedure in docs/security/qa-readonly-role.md (run as the bootstrap superuser, explicit UUID, never from the application, never from HTTP).
--
-- THE VIEWS: `CREATE OR REPLACE VIEW` keeps the OID, so the 27 policies of 0051 (which store the view by OID) keep using it, and the owner (app_migrator) and the
-- GRANT SELECT to app_qa_readonly are preserved. A view runs with its OWNER's privileges, which is why app_qa_readonly never needs a grant on the config table or on
-- `tenants`. security_barrier is restated (CREATE OR REPLACE resets reloptions that are not given).
CREATE TABLE "qa_readonly_tenant_config" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"authorized_tenant_id" uuid NOT NULL,
	"configured_by" text DEFAULT session_user NOT NULL,
	"configured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "qa_readonly_tenant_config_singleton_check" CHECK ("qa_readonly_tenant_config"."singleton"),
	CONSTRAINT "qa_readonly_tenant_config_reason_check" CHECK (length(btrim("qa_readonly_tenant_config"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "qa_readonly_tenant_config" ADD CONSTRAINT "qa_readonly_tenant_config_tenant_fk" FOREIGN KEY ("authorized_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "qa_readonly_tenant_config" FROM app_migrator;
--> statement-breakpoint
CREATE OR REPLACE VIEW qa_readonly_scope WITH (security_barrier = true) AS
  SELECT c.authorized_tenant_id AS tenant_id
  FROM qa_readonly_tenant_config c
  JOIN tenants t ON t.id = c.authorized_tenant_id
  WHERE t.status = 'active';
--> statement-breakpoint
CREATE OR REPLACE VIEW qa_readonly_tenant WITH (security_barrier = true) AS
  SELECT t.id, t.name, t.slug, t.status
  FROM qa_readonly_tenant_config c
  JOIN tenants t ON t.id = c.authorized_tenant_id;
