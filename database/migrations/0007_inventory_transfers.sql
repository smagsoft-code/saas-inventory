CREATE TABLE "inventory_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"quantity_requested" numeric NOT NULL,
	"quantity_dispatched" numeric DEFAULT '0' NOT NULL,
	"quantity_received" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfer_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_transfer_items_tenant_transfer_variant_key" UNIQUE("tenant_id","transfer_id","product_variant_id"),
	CONSTRAINT "inventory_transfer_items_requested_check" CHECK ("inventory_transfer_items"."quantity_requested" > 0),
	CONSTRAINT "inventory_transfer_items_dispatched_check" CHECK ("inventory_transfer_items"."quantity_dispatched" >= 0),
	CONSTRAINT "inventory_transfer_items_received_check" CHECK ("inventory_transfer_items"."quantity_received" >= 0),
	CONSTRAINT "inventory_transfer_items_dispatched_le_requested_check" CHECK ("inventory_transfer_items"."quantity_dispatched" <= "inventory_transfer_items"."quantity_requested"),
	CONSTRAINT "inventory_transfer_items_received_le_dispatched_check" CHECK ("inventory_transfer_items"."quantity_received" <= "inventory_transfer_items"."quantity_dispatched")
);
--> statement-breakpoint
ALTER TABLE "inventory_transfer_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_transfer_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"transfer_item_id" uuid NOT NULL,
	"quantity_received" numeric NOT NULL,
	"incident_type" text,
	"incident_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfer_receipt_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_transfer_receipt_items_quantity_check" CHECK ("inventory_transfer_receipt_items"."quantity_received" > 0),
	CONSTRAINT "inventory_transfer_receipt_items_incident_type_check" CHECK ("inventory_transfer_receipt_items"."incident_type" IS NULL OR "inventory_transfer_receipt_items"."incident_type" IN ('shortage', 'damage', 'excess'))
);
--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipt_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_transfer_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"received_by" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfer_receipts_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"dispatched_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "inventory_transfers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_transfers_status_check" CHECK ("inventory_transfers"."status" IN ('draft', 'approved', 'preparing', 'dispatched', 'partially_received', 'received', 'cancelled')),
	CONSTRAINT "inventory_transfers_locations_distinct_check" CHECK ("inventory_transfers"."source_location_id" <> "inventory_transfers"."destination_location_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_transfer_items" ADD CONSTRAINT "inventory_transfer_items_transfer_fk" FOREIGN KEY ("tenant_id","transfer_id") REFERENCES "public"."inventory_transfers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_items" ADD CONSTRAINT "inventory_transfer_items_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipt_items" ADD CONSTRAINT "inventory_transfer_receipt_items_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."inventory_transfer_receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipt_items" ADD CONSTRAINT "inventory_transfer_receipt_items_item_fk" FOREIGN KEY ("tenant_id","transfer_item_id") REFERENCES "public"."inventory_transfer_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_transfer_fk" FOREIGN KEY ("tenant_id","transfer_id") REFERENCES "public"."inventory_transfers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_source_fk" FOREIGN KEY ("tenant_id","source_location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_fk" FOREIGN KEY ("tenant_id","destination_location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_dispatched_by_fk" FOREIGN KEY ("tenant_id","dispatched_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_transfer_items_tenant_transfer_idx" ON "inventory_transfer_items" USING btree ("tenant_id","transfer_id");--> statement-breakpoint
CREATE INDEX "inventory_transfer_items_tenant_variant_idx" ON "inventory_transfer_items" USING btree ("tenant_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "inventory_transfer_receipt_items_tenant_receipt_idx" ON "inventory_transfer_receipt_items" USING btree ("tenant_id","receipt_id");--> statement-breakpoint
CREATE INDEX "inventory_transfer_receipts_tenant_transfer_idx" ON "inventory_transfer_receipts" USING btree ("tenant_id","transfer_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_tenant_status_created_idx" ON "inventory_transfers" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "inventory_transfers_tenant_source_idx" ON "inventory_transfers" USING btree ("tenant_id","source_location_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_tenant_destination_idx" ON "inventory_transfers" USING btree ("tenant_id","destination_location_id");--> statement-breakpoint
CREATE POLICY "inventory_transfer_items_tenant_isolation" ON "inventory_transfer_items" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "inventory_transfer_receipt_items_tenant_isolation" ON "inventory_transfer_receipt_items" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "inventory_transfer_receipts_tenant_isolation" ON "inventory_transfer_receipts" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "inventory_transfers_tenant_isolation" ON "inventory_transfers" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "inventory_transfer_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipt_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_transfers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- inventory_transfer_items: quantity_dispatched/received updated in place (materialized running
-- total); hard-deleted only while the parent transfer is 'draft' (database.md#soft-delete-policy).
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_transfer_items TO app_tenant;
--> statement-breakpoint
-- Receiving events/lines: append-only, never updated or deleted.
GRANT SELECT, INSERT ON inventory_transfer_receipt_items TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT ON inventory_transfer_receipts TO app_tenant;
--> statement-breakpoint
-- inventory_transfers: status-driven lifecycle, no deleted_at, no DELETE grant.
GRANT SELECT, INSERT, UPDATE ON inventory_transfers TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON inventory_transfer_items, inventory_transfer_receipt_items,
	inventory_transfer_receipts, inventory_transfers TO app_platform;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON inventory_transfer_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON inventory_transfers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON inventory_transfer_items
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON inventory_transfer_receipt_items
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON inventory_transfer_receipts
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON inventory_transfers
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();