CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action_code" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"correlation_id" uuid,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_type_check" CHECK ("audit_log"."actor_type" IN ('user', 'platform_admin', 'system'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "roles_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "roles_tenant_id_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_roles" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	CONSTRAINT "user_roles_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "users_tenant_id_email_key" UNIQUE("tenant_id","email"),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('invited', 'active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_entity_idx" ON "audit_log" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_at_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_code_created_at_idx" ON "audit_log" USING btree ("action_code","created_at");--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "role_permissions_tenant_isolation" ON "role_permissions" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "roles_tenant_isolation" ON "roles" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "user_roles_tenant_isolation" ON "user_roles" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- FORCE ROW LEVEL SECURITY: belt-and-suspenders per database.md#row-level-security — redundant
-- in production (app_tenant never owns these tables) but protects a local/dev setup where a
-- single role gets sloppily reused for both migrating and querying. Not generated by Drizzle Kit
-- from the TS schema, so it is added here by hand for every RLS table this migration creates.
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- GRANTs: RLS policies restrict which ROWS a role can touch; the role still needs the ordinary
-- table-level GRANT to attempt the operation at all. audit_log is append-only (no UPDATE/DELETE
-- grant — database.md#soft-delete-policy); role_permissions/user_roles are hard-deleted join
-- tables (no UPDATE grant — reassignment is delete+insert, not in-place update); users/roles are
-- soft-deleted (no DELETE grant — removal is UPDATE deleted_at).
GRANT SELECT, INSERT ON audit_log TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON role_permissions TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON roles TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON user_roles TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users TO app_tenant;
--> statement-breakpoint

-- app_platform (SuperAdmin-only service methods) reads across tenants via BYPASSRLS — see
-- database.md#administrative--cross-tenant-queries. Read-only: SuperAdmin aggregation never
-- writes through this path.
GRANT SELECT ON audit_log, roles, role_permissions, user_roles, users TO app_platform;
--> statement-breakpoint

-- Trigger-enforced invariants (database.md#constraints). set_updated_at only where updated_at
-- exists; prevent_tenant_id_change on every tenant-owned table this migration creates.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON role_permissions
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON user_roles
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();