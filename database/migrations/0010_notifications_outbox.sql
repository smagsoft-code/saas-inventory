CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_outbox_status_check" CHECK ("event_outbox"."status" IN ('pending', 'processing', 'delivered', 'dead_letter'))
);
--> statement-breakpoint
ALTER TABLE "event_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_outbox_pending_created_idx" ON "event_outbox" USING btree ("status","created_at") WHERE "event_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "event_outbox_tenant_created_idx" ON "event_outbox" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "event_outbox_tenant_isolation" ON "event_outbox" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "event_outbox_event_processor_access" ON "event_outbox" AS PERMISSIVE FOR ALL TO "app_event_processor" USING (true) WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "event_outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- app_tenant only ever writes an event in the same transaction as the business operation that
-- caused it (database.md#outbox) — it never claims/processes/deletes rows, that is
-- app_event_processor's job via its own separate policy above.
GRANT SELECT, INSERT ON event_outbox TO app_tenant;
--> statement-breakpoint
-- app_event_processor claims (UPDATE status/claimed_at/claimed_by) and marks delivery
-- (UPDATE status/processed_at) — no DELETE, retention/archival is an explicitly undecided
-- operational question (database.md#open-decisions-carried-forward), not implemented here.
GRANT SELECT, UPDATE ON event_outbox TO app_event_processor;
--> statement-breakpoint
GRANT SELECT ON event_outbox TO app_platform;
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON event_outbox
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();