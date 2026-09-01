-- GLOBAL IDENTITY + TENANT MEMBERSHIPS (016-B / ADR-0033) — database layer only.
--
-- Both tables are PLATFORM-SCOPED: same access-control-by-GRANT-only posture as `tenants`,
-- `platform_admins` and `platform_admin_refresh_tokens` (migrations 0001 / 0022) — NO
-- `ENABLE ROW LEVEL SECURITY`, NO policy. `identities` has no tenant dimension at all;
-- `tenant_memberships` carries `tenant_id` only as a foreign key, never as an RLS key.
-- `app_tenant` gets NO GRANT on either table, so a tenant-scoped request can never enumerate
-- identities or memberships (multi-tenancy.md's "a tenant connection never lists across tenants").
--
-- This migration is additive. It does NOT touch auth.service.ts, the guards, the JWT, RLS on any
-- existing table, or `users` (schema or data) at all — `users.password_hash` stays exactly as it
-- is. Migration 0029 only reads `users` to backfill `identities`/`tenant_memberships`; it never
-- writes to `users`. The current tenantSlug-based login keeps working completely unchanged.

CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"full_name" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "identities_status_check" CHECK ("identities"."status" IN ('active', 'pending_credential', 'disabled')),
	CONSTRAINT "identities_credential_check" CHECK ("identities"."password_hash" IS NOT NULL OR "identities"."status" = 'pending_credential')
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_identity_id_tenant_id_key" UNIQUE("identity_id","tenant_id"),
	CONSTRAINT "tenant_memberships_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "tenant_memberships_status_check" CHECK ("tenant_memberships"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_identity_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_email_lower_key" ON "identities" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "tenant_memberships_identity_idx" ON "tenant_memberships" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "tenant_memberships_tenant_idx" ON "tenant_memberships" USING btree ("tenant_id");--> statement-breakpoint

-- GRANTs (hand-added — Drizzle Kit does not generate role grants from the TS schema). No RLS
-- policy exists on these tables, so access is by GRANT alone. app_platform is the only
-- application role that touches them (the future email+password auth path and the migration 0029
-- backfill both run there). No DELETE: an identity/membership is soft-disabled via `status`,
-- never hard-deleted (same convention as `users` / `roles` — migration 0002).
GRANT SELECT, INSERT, UPDATE ON identities TO app_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_memberships TO app_platform;
--> statement-breakpoint

-- Trigger-enforced invariants (database.md#constraints), same shared functions migration 0000
-- defines and every table since uses.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON identities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenant_memberships
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- A membership's tenant_id is immutable after insert — you never move a membership between
-- companies, you create a new one. `identities` has no tenant_id, so the trigger does not apply
-- there. (`tenant_memberships` is not tenant-owned / RLS, but tenant_id immutability is still the
-- correct integrity property, and the composite FK below already ties it to users.tenant_id.)
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON tenant_memberships
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();