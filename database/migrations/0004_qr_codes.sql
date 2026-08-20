CREATE TABLE "qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "qr_codes_code_key" UNIQUE("code"),
	CONSTRAINT "qr_codes_target_type_check" CHECK ("qr_codes"."target_type" IN ('product_variant', 'location')),
	CONSTRAINT "qr_codes_status_check" CHECK ("qr_codes"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "qr_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "qr_codes_tenant_isolation" ON "qr_codes" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "qr_codes_public_resolve" ON "qr_codes" AS PERMISSIVE FOR SELECT TO "app_public_resolver" USING ("qr_codes"."status" = 'active' AND ("qr_codes"."expires_at" IS NULL OR "qr_codes"."expires_at" > now()));
--> statement-breakpoint

ALTER TABLE "qr_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- No deleted_at — status ('active'/'revoked') governs lifecycle, no DELETE grant.
GRANT SELECT, INSERT, UPDATE ON qr_codes TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON qr_codes TO app_platform;
--> statement-breakpoint
-- app_public_resolver's row access is scoped by the qr_codes_public_resolve policy above; this
-- GRANT is the matching table-level privilege it needs to run that SELECT at all.
GRANT SELECT ON qr_codes TO app_public_resolver;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON qr_codes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON qr_codes
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();