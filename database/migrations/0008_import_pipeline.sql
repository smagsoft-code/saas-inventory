CREATE TABLE "import_job_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"mapped_data" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"match_action" text,
	"matched_product_variant_id" uuid,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_job_rows_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_job_rows_tenant_job_row_key" UNIQUE("tenant_id","import_job_id","row_number"),
	CONSTRAINT "import_job_rows_status_check" CHECK ("import_job_rows"."status" IN ('pending', 'valid', 'warning', 'invalid', 'imported', 'skipped')),
	CONSTRAINT "import_job_rows_match_action_check" CHECK ("import_job_rows"."match_action" IS NULL OR "import_job_rows"."match_action" IN ('create', 'update', 'skip'))
);
--> statement-breakpoint
ALTER TABLE "import_job_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"default_location_id" uuid,
	"mapping_template_id" uuid,
	"column_mapping" jsonb NOT NULL,
	"duplicate_handling_mode" text DEFAULT 'update_catalog_only' NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer,
	"valid_rows" integer,
	"invalid_rows" integer,
	"warning_rows" integer,
	"imported_rows" integer,
	"error_report_storage_key" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_jobs_duplicate_handling_mode_check" CHECK ("import_jobs"."duplicate_handling_mode" IN ('update_catalog_only', 'update_catalog_and_inventory', 'skip_existing', 'reject_on_duplicate')),
	CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" IN ('uploaded', 'mapping', 'validating', 'ready', 'importing', 'completed', 'completed_with_errors', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_mapping_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"column_mapping" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_mapping_templates_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_mapping_templates_tenant_id_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_fk" FOREIGN KEY ("tenant_id","import_job_id") REFERENCES "public"."import_jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_matched_variant_fk" FOREIGN KEY ("tenant_id","matched_product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_default_location_fk" FOREIGN KEY ("tenant_id","default_location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_mapping_template_fk" FOREIGN KEY ("tenant_id","mapping_template_id") REFERENCES "public"."import_mapping_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_job_rows_tenant_job_status_idx" ON "import_job_rows" USING btree ("tenant_id","import_job_id","status");--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_status_created_idx" ON "import_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE POLICY "import_job_rows_tenant_isolation" ON "import_job_rows" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "import_jobs_tenant_isolation" ON "import_jobs" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "import_mapping_templates_tenant_isolation" ON "import_mapping_templates" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "import_job_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_mapping_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON import_job_rows TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON import_jobs TO app_tenant;
--> statement-breakpoint
-- Hard-deleted on user removal — safe because import_jobs.column_mapping is always a frozen copy
-- (database.md#soft-delete-policy).
GRANT SELECT, INSERT, UPDATE, DELETE ON import_mapping_templates TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON import_job_rows, import_jobs, import_mapping_templates TO app_platform;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON import_job_rows
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON import_jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON import_mapping_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON import_job_rows
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON import_jobs
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON import_mapping_templates
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();