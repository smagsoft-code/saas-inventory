CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"negotiated_unit_price" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "cart_items_tenant_cart_variant_key" UNIQUE("tenant_id","cart_id","product_variant_id"),
	CONSTRAINT "cart_items_quantity_check" CHECK ("cart_items"."quantity" > 0),
	CONSTRAINT "cart_items_negotiated_price_check" CHECK ("cart_items"."negotiated_unit_price" IS NULL OR "cart_items"."negotiated_unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "carts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "carts_status_check" CHECK ("carts"."status" IN ('open', 'checked_out', 'abandoned'))
);
--> statement-breakpoint
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"tax_id" text,
	"email" text,
	"phone" text,
	"address" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_type_check" CHECK ("customers"."type" IN ('individual', 'business')),
	CONSTRAINT "customers_status_check" CHECK ("customers"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"sku_snapshot" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"max_price_snapshot" numeric NOT NULL,
	"base_price_snapshot" numeric NOT NULL,
	"min_price_snapshot" numeric NOT NULL,
	"unit_price_snapshot" numeric NOT NULL,
	"unit_cost_snapshot" numeric,
	"quantity" numeric NOT NULL,
	"discount_amount" numeric DEFAULT '0' NOT NULL,
	"is_exceptional_discount" boolean DEFAULT false NOT NULL,
	"line_total" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "order_items_max_price_snapshot_check" CHECK ("order_items"."max_price_snapshot" >= 0),
	CONSTRAINT "order_items_base_price_snapshot_check" CHECK ("order_items"."base_price_snapshot" >= 0),
	CONSTRAINT "order_items_min_price_snapshot_check" CHECK ("order_items"."min_price_snapshot" >= 0),
	CONSTRAINT "order_items_unit_price_snapshot_check" CHECK ("order_items"."unit_price_snapshot" >= 0),
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_discount_amount_check" CHECK ("order_items"."discount_amount" >= 0),
	CONSTRAINT "order_items_line_total_check" CHECK ("order_items"."line_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_name_snapshot" text NOT NULL,
	"customer_tax_id_snapshot" text,
	"customer_email_snapshot" text,
	"customer_phone_snapshot" text,
	"customer_address_snapshot" jsonb,
	"order_number" text NOT NULL,
	"document_type" text NOT NULL,
	"invoice_status" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal" numeric NOT NULL,
	"discount_total" numeric DEFAULT '0' NOT NULL,
	"tax_total" numeric DEFAULT '0' NOT NULL,
	"total" numeric NOT NULL,
	"currency" char(3) NOT NULL,
	"placed_by_user_id" uuid,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "orders_tenant_id_order_number_key" UNIQUE("tenant_id","order_number"),
	CONSTRAINT "orders_document_type_check" CHECK ("orders"."document_type" IN ('invoice', 'sales_note')),
	CONSTRAINT "orders_invoice_status_check" CHECK ("orders"."invoice_status" IS NULL OR "orders"."invoice_status" IN ('pending', 'issued', 'failed')),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('draft', 'pending', 'confirmed', 'fulfilled', 'cancelled')),
	CONSTRAINT "orders_subtotal_check" CHECK ("orders"."subtotal" >= 0),
	CONSTRAINT "orders_discount_total_check" CHECK ("orders"."discount_total" >= 0),
	CONSTRAINT "orders_tax_total_check" CHECK ("orders"."tax_total" >= 0),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total" >= 0),
	CONSTRAINT "orders_document_invoice_status_consistency_check" CHECK (("orders"."document_type" = 'invoice' AND "orders"."invoice_status" IS NOT NULL) OR ("orders"."document_type" = 'sales_note' AND "orders"."invoice_status" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"requested_price" numeric NOT NULL,
	"min_price_at_request" numeric NOT NULL,
	"max_price_at_request" numeric NOT NULL,
	"discount_amount" numeric NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "price_approvals_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "price_approvals_requested_price_check" CHECK ("price_approvals"."requested_price" >= 0),
	CONSTRAINT "price_approvals_min_price_at_request_check" CHECK ("price_approvals"."min_price_at_request" >= 0),
	CONSTRAINT "price_approvals_max_price_at_request_check" CHECK ("price_approvals"."max_price_at_request" >= 0),
	CONSTRAINT "price_approvals_discount_amount_check" CHECK ("price_approvals"."discount_amount" >= 0),
	CONSTRAINT "price_approvals_status_check" CHECK ("price_approvals"."status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "price_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"quantity_returned" numeric NOT NULL,
	"disposition" text,
	"disposition_location_id" uuid,
	"inspected_by" uuid,
	"inspected_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_return_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_return_items_quantity_check" CHECK ("sales_return_items"."quantity_returned" > 0),
	CONSTRAINT "sales_return_items_disposition_check" CHECK ("sales_return_items"."disposition" IS NULL OR "sales_return_items"."disposition" IN ('restock', 'quarantine', 'damaged', 'scrap'))
);
--> statement-breakpoint
ALTER TABLE "sales_return_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid NOT NULL,
	"received_by" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_returns_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_returns_status_check" CHECK ("sales_returns"."status" IN ('requested', 'inspecting', 'resolved', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "sales_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_fk" FOREIGN KEY ("tenant_id","cart_id") REFERENCES "public"."carts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_fk" FOREIGN KEY ("tenant_id","placed_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_approvals" ADD CONSTRAINT "price_approvals_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_approvals" ADD CONSTRAINT "price_approvals_order_item_fk" FOREIGN KEY ("tenant_id","order_item_id") REFERENCES "public"."order_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_approvals" ADD CONSTRAINT "price_approvals_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_approvals" ADD CONSTRAINT "price_approvals_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_fk" FOREIGN KEY ("tenant_id","return_id") REFERENCES "public"."sales_returns"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_order_item_fk" FOREIGN KEY ("tenant_id","order_item_id") REFERENCES "public"."order_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_disposition_location_fk" FOREIGN KEY ("tenant_id","disposition_location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_inspected_by_fk" FOREIGN KEY ("tenant_id","inspected_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_tenant_user_open_idx" ON "carts" USING btree ("tenant_id","user_id","status") WHERE "carts"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_id_tax_id_key" ON "customers" USING btree ("tenant_id","tax_id") WHERE "customers"."tax_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_tenant_customer_idx" ON "orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_status_created_idx" ON "orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_approvals_tenant_pending_item_key" ON "price_approvals" USING btree ("tenant_id","order_item_id") WHERE "price_approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "price_approvals_tenant_pending_queue_idx" ON "price_approvals" USING btree ("tenant_id","status","requested_at") WHERE "price_approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "price_approvals_tenant_order_idx" ON "price_approvals" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "sales_return_items_tenant_order_item_idx" ON "sales_return_items" USING btree ("tenant_id","order_item_id");--> statement-breakpoint
CREATE INDEX "sales_returns_tenant_order_idx" ON "sales_returns" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "sales_returns_tenant_status_created_idx" ON "sales_returns" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE POLICY "cart_items_tenant_isolation" ON "cart_items" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "carts_tenant_isolation" ON "carts" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "customers_tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "order_items_tenant_isolation" ON "order_items" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "price_approvals_tenant_isolation" ON "price_approvals" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "sales_return_items_tenant_isolation" ON "sales_return_items" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "sales_returns_tenant_isolation" ON "sales_returns" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "cart_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "carts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "price_approvals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales_return_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales_returns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- carts/cart_items: ephemeral pre-transactional data, hard-deleted once abandoned past
-- expires_at (database.md#cart).
GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON carts TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON customers TO app_tenant;
--> statement-breakpoint
-- order_items: no updated_at column at all — hard-deleted only while the parent order is
-- 'draft' (database.md#soft-delete-policy), otherwise part of immutable order history.
GRANT SELECT, INSERT, DELETE ON order_items TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON orders TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON price_approvals TO app_tenant;
--> statement-breakpoint
-- sales_return_items: disposition/inspected_by/inspected_at are set post-creation by the
-- inspection step (database.md#sales-returns-and-disposition) — no DELETE, it is a permanent
-- record of what happened to a return line.
GRANT SELECT, INSERT, UPDATE ON sales_return_items TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sales_returns TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON cart_items, carts, customers, order_items, orders, price_approvals,
	sales_return_items, sales_returns TO app_platform;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON cart_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON carts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sales_returns
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON cart_items
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON carts
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON order_items
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON price_approvals
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON sales_return_items
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON sales_returns
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();