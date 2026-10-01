-- TENANT ONBOARDING + TENANT SUPPORT (platform-ops block) — ADR-0036. Two platform-scoped tables,
-- same access-control-by-GRANT-only posture as `tenants` / `platform_admins` / `identities` /
-- `tenant_memberships` (migrations 0001/0028) — NO RLS, reachable only by `app_platform` (and
-- `app_migrator`). `app_tenant` gets NO GRANT on either, so a tenant-scoped connection can never
-- enumerate invitations or support sessions, same invariant migration 0028 already established.
CREATE TABLE "platform_support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_admin_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_support_sessions_mode_check" CHECK ("platform_support_sessions"."mode" IN ('read', 'write')),
	CONSTRAINT "platform_support_sessions_status_check" CHECK ("platform_support_sessions"."status" IN ('active', 'ended', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "tenant_admin_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_admin_invitations_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "tenant_admin_invitations_status_check" CHECK ("tenant_admin_invitations"."status" IN ('pending', 'sent', 'accepted', 'expired', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "platform_support_sessions" ADD CONSTRAINT "platform_support_sessions_admin_fk" FOREIGN KEY ("platform_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_support_sessions" ADD CONSTRAINT "platform_support_sessions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_admin_invitations" ADD CONSTRAINT "tenant_admin_invitations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_admin_invitations" ADD CONSTRAINT "tenant_admin_invitations_identity_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_admin_invitations" ADD CONSTRAINT "tenant_admin_invitations_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_support_sessions_tenant_idx" ON "platform_support_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "platform_support_sessions_admin_idx" ON "platform_support_sessions" USING btree ("platform_admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_support_sessions_admin_active_key" ON "platform_support_sessions" USING btree ("platform_admin_id") WHERE "platform_support_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "tenant_admin_invitations_tenant_idx" ON "tenant_admin_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_admin_invitations_identity_idx" ON "tenant_admin_invitations" USING btree ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_admin_invitations_user_live_key" ON "tenant_admin_invitations" USING btree ("user_id") WHERE "tenant_admin_invitations"."status" IN ('pending', 'sent');
--> statement-breakpoint

-- GRANTs (hand-added — Drizzle Kit does not generate role grants from the TS schema), same
-- precedent as migration 0028. app_platform is the only application role that touches either
-- table. No DELETE on either: an invitation/session is never physically removed, only moved to a
-- terminal status (same soft-delete-by-status convention as every other table in this codebase).
GRANT SELECT, INSERT, UPDATE ON platform_support_sessions TO app_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_admin_invitations TO app_platform;
--> statement-breakpoint

-- Tenant Support's one curated MVP write action (ADR-0036 §9: warehouse status toggle, the exact
-- worked example the brief itself uses) — a narrow, column-level grant, same convention as
-- migration 0018's `GRANT SELECT (id, tenant_id, name, code, status) ON locations`. app_platform
-- already has full-row SELECT on `users`/`roles`/`role_permissions`/`user_roles` (migration 0002)
-- and on `warehouses`/`locations`/`inventory_balances`/`inventory_movements` (migration 0005) —
-- both already sufficient for this block's SUPPORT_READ surface (tenant users + warehouses) with
-- no further grant needed; only the WRITE side is new.
GRANT UPDATE (status) ON warehouses TO app_platform;

-- Trigger-enforced invariants (database.md#constraints), same shared functions migration 0000
-- defines and every table since uses.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_support_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenant_admin_invitations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();