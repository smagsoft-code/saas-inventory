CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "idempotency_keys_tenant_scope_key_key" UNIQUE("tenant_id","scope","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "idempotency_keys_tenant_isolation" ON "idempotency_keys" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Write-once until TTL cleanup deletes it (database.md#idempotency) — no UPDATE grant.
GRANT SELECT, INSERT, DELETE ON idempotency_keys TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON idempotency_keys TO app_platform;
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON idempotency_keys
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();