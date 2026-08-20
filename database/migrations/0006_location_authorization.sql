CREATE TABLE "user_location_assignments" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	CONSTRAINT "user_location_assignments_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "user_location_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_location_assignments" ADD CONSTRAINT "user_location_assignments_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_location_assignments" ADD CONSTRAINT "user_location_assignments_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_location_assignments_tenant_location_idx" ON "user_location_assignments" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE POLICY "user_location_assignments_tenant_isolation" ON "user_location_assignments" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "user_location_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Hard-deleted join table, no UPDATE — reassignment is delete+insert (database.md#location-scoped-authorization).
GRANT SELECT, INSERT, DELETE ON user_location_assignments TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON user_location_assignments TO app_platform;
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON user_location_assignments
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();