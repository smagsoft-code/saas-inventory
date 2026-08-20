CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"data_type" text NOT NULL,
	"applies_to" text NOT NULL,
	"unit_id" uuid,
	"is_required_default" boolean DEFAULT false NOT NULL,
	"min_value" numeric,
	"max_value" numeric,
	"status" text DEFAULT 'active' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attribute_definitions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attribute_definitions_tenant_id_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "attribute_definitions_data_type_check" CHECK ("attribute_definitions"."data_type" IN ('text', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multi_select')),
	CONSTRAINT "attribute_definitions_applies_to_check" CHECK ("attribute_definitions"."applies_to" IN ('product', 'variant')),
	CONSTRAINT "attribute_definitions_status_check" CHECK ("attribute_definitions"."status" IN ('active', 'inactive')),
	CONSTRAINT "attribute_definitions_value_range_check" CHECK ("attribute_definitions"."min_value" IS NULL OR "attribute_definitions"."max_value" IS NULL OR "attribute_definitions"."min_value" <= "attribute_definitions"."max_value"),
	CONSTRAINT "attribute_definitions_value_type_check" CHECK ("attribute_definitions"."data_type" IN ('number', 'decimal') OR ("attribute_definitions"."min_value" IS NULL AND "attribute_definitions"."max_value" IS NULL)),
	CONSTRAINT "attribute_definitions_unit_type_check" CHECK ("attribute_definitions"."data_type" IN ('number', 'decimal') OR "attribute_definitions"."unit_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "attribute_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attribute_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attribute_definition_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_options_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attribute_options_tenant_def_code_key" UNIQUE("tenant_id","attribute_definition_id","code"),
	CONSTRAINT "attribute_options_status_check" CHECK ("attribute_options"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "attribute_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "brands_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "brands_tenant_id_name_key" UNIQUE("tenant_id","name"),
	CONSTRAINT "brands_status_check" CHECK ("brands"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_category_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "categories_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "categories_tenant_id_slug_key" UNIQUE("tenant_id","slug"),
	CONSTRAINT "categories_status_check" CHECK ("categories"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "category_attributes" (
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"attribute_definition_id" uuid NOT NULL,
	"is_required" boolean,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_attributes_pk" PRIMARY KEY("category_id","attribute_definition_id")
);
--> statement-breakpoint
ALTER TABLE "category_attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "measurement_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"dimension" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_units_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_variant_id" uuid,
	"storage_key" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"manufactured_date" date,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_lots_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_lots_tenant_variant_lot_key" UNIQUE("tenant_id","product_variant_id","lot_number")
);
--> statement-breakpoint
ALTER TABLE "product_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"max_price" numeric NOT NULL,
	"base_price" numeric NOT NULL,
	"min_price" numeric NOT NULL,
	"changed_by" uuid,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_price_history_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_price_history_max_price_check" CHECK ("product_price_history"."max_price" >= 0),
	CONSTRAINT "product_price_history_base_price_check" CHECK ("product_price_history"."base_price" >= 0),
	CONSTRAINT "product_price_history_min_price_check" CHECK ("product_price_history"."min_price" >= 0),
	CONSTRAINT "product_price_history_price_tier_check" CHECK ("product_price_history"."min_price" <= "product_price_history"."base_price" AND "product_price_history"."base_price" <= "product_price_history"."max_price")
);
--> statement-breakpoint
ALTER TABLE "product_price_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_serials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_serials_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_serials_tenant_id_serial_key" UNIQUE("tenant_id","serial_number"),
	CONSTRAINT "product_serials_status_check" CHECK ("product_serials"."status" IN ('in_stock', 'sold', 'returned'))
);
--> statement-breakpoint
ALTER TABLE "product_serials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"unit" text DEFAULT 'unit' NOT NULL,
	"max_price" numeric NOT NULL,
	"base_price" numeric NOT NULL,
	"min_price" numeric NOT NULL,
	"cost" numeric,
	"status" text DEFAULT 'active' NOT NULL,
	"is_serialized" boolean DEFAULT false NOT NULL,
	"is_lot_tracked" boolean DEFAULT false NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_variants_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_variants_tenant_id_sku_key" UNIQUE("tenant_id","sku"),
	CONSTRAINT "product_variants_max_price_check" CHECK ("product_variants"."max_price" >= 0),
	CONSTRAINT "product_variants_base_price_check" CHECK ("product_variants"."base_price" >= 0),
	CONSTRAINT "product_variants_min_price_check" CHECK ("product_variants"."min_price" >= 0),
	CONSTRAINT "product_variants_cost_check" CHECK ("product_variants"."cost" IS NULL OR "product_variants"."cost" >= 0),
	CONSTRAINT "product_variants_status_check" CHECK ("product_variants"."status" IN ('active', 'discontinued')),
	CONSTRAINT "product_variants_tracking_mode_check" CHECK (NOT ("product_variants"."is_serialized" AND "product_variants"."is_lot_tracked")),
	CONSTRAINT "product_variants_price_tier_check" CHECK ("product_variants"."min_price" <= "product_variants"."base_price" AND "product_variants"."base_price" <= "product_variants"."max_price")
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"brand_id" uuid,
	"supplier_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"warranty_months" integer,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_status_check" CHECK ("products"."status" IN ('draft', 'active', 'discontinued')),
	CONSTRAINT "products_warranty_months_check" CHECK ("products"."warranty_months" IS NULL OR "products"."warranty_months" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
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
	CONSTRAINT "suppliers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_status_check" CHECK ("suppliers"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_price_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exceptional_discount_requires_approval" boolean DEFAULT true NOT NULL,
	"max_discount_below_min_percent" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_price_policies_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_price_policies_tenant_id_key" UNIQUE("tenant_id"),
	CONSTRAINT "tenant_price_policies_max_discount_check" CHECK ("tenant_price_policies"."max_discount_below_min_percent" IS NULL OR "tenant_price_policies"."max_discount_below_min_percent" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tenant_price_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."measurement_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_definition_fk" FOREIGN KEY ("tenant_id","attribute_definition_id") REFERENCES "public"."attribute_definitions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("tenant_id","parent_category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_definition_fk" FOREIGN KEY ("tenant_id","attribute_definition_id") REFERENCES "public"."attribute_definitions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_changed_by_fk" FOREIGN KEY ("tenant_id","changed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_price_policies" ADD CONSTRAINT "tenant_price_policies_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribute_definitions_tenant_status_idx" ON "attribute_definitions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "attribute_options_tenant_def_status_idx" ON "attribute_options" USING btree ("tenant_id","attribute_definition_id","status");--> statement-breakpoint
CREATE INDEX "category_attributes_tenant_category_idx" ON "category_attributes" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "product_price_history_tenant_variant_effective_idx" ON "product_price_history" USING btree ("tenant_id","product_variant_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_tenant_id_barcode_key" ON "product_variants" USING btree ("tenant_id","barcode") WHERE "product_variants"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_variants_tenant_product_idx" ON "product_variants" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "products_tenant_category_idx" ON "products" USING btree ("tenant_id","category_id") WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "products_tenant_status_idx" ON "products" USING btree ("tenant_id","status") WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_id_tax_id_key" ON "suppliers" USING btree ("tenant_id","tax_id") WHERE "suppliers"."tax_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "attribute_definitions_tenant_isolation" ON "attribute_definitions" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "attribute_options_tenant_isolation" ON "attribute_options" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "brands_tenant_isolation" ON "brands" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "category_attributes_tenant_isolation" ON "category_attributes" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "product_images_tenant_isolation" ON "product_images" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "product_lots_tenant_isolation" ON "product_lots" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "product_price_history_tenant_isolation" ON "product_price_history" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "product_serials_tenant_isolation" ON "product_serials" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "product_variants_tenant_isolation" ON "product_variants" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "suppliers_tenant_isolation" ON "suppliers" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_price_policies_tenant_isolation" ON "tenant_price_policies" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "attribute_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "attribute_options" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "category_attributes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_lots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_price_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_serials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_price_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- GRANTs — table-level privilege, distinct from the row-level POLICY above. Soft-delete tables
-- (attribute_definitions, brands, categories, product_variants, products, suppliers): no DELETE,
-- removal is UPDATE deleted_at. attribute_options/tenant_price_policies: status-driven or
-- singleton config, no DELETE. category_attributes/product_images: hard-deleted detail rows, full
-- CRUD. product_lots: append-only reference data, no UPDATE/DELETE. product_price_history: append-
-- only except closing the previous row's effective_to (database.md#pricing), no DELETE.
-- product_serials: status transitions in place, no DELETE.
GRANT SELECT, INSERT, UPDATE ON attribute_definitions TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attribute_options TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON brands TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON categories TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON category_attributes TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON product_images TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT ON product_lots TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON product_price_history TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON product_serials TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON product_variants TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON products TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON suppliers TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_price_policies TO app_tenant;
--> statement-breakpoint

-- measurement_units: platform-scoped catalog, no RLS — readable by every role, writable only by
-- app_migrator (the owner), exactly like permissions (database.md#dynamic-attributes-governance).
GRANT SELECT ON measurement_units TO app_tenant, app_platform, app_event_processor, app_public_resolver;
--> statement-breakpoint

-- app_platform: read-only cross-tenant aggregation (database.md#administrative--cross-tenant-queries).
GRANT SELECT ON attribute_definitions, attribute_options, brands, categories, category_attributes,
	product_images, product_lots, product_price_history, product_serials, product_variants,
	products, suppliers, tenant_price_policies TO app_platform;
--> statement-breakpoint

-- app_public_resolver: the column-level GRANT the QR resolver needs to render a public response —
-- never base_price/min_price/cost (database.md#qr-codes). Declared here, alongside
-- product_variants'/products' own creation, rather than deferred to the QR migration.
--
-- database.md's own §QR codes snippet lists `name` as a product_variants column
-- ("GRANT SELECT (id, tenant_id, product_id, name, max_price, status) ON product_variants..."),
-- but product_variants has no `name` column (see §Catalog) — name lives on products. This is a
-- discrepancy inside database.md itself, not a new architectural decision: the doc's own
-- "Database roles" table already anticipates app_public_resolver needing columns from BOTH
-- product_variants and products ("SELECT on the specific columns of products/locations needed to
-- render a public response"). Corrected here to grant `name` from products instead, discovered by
-- running this migration against a real PostgreSQL instance (PROMPT 03-A) — Postgres rejects a
-- GRANT naming a column that does not exist on the target relation.
GRANT SELECT (id, tenant_id, product_id, max_price, status) ON product_variants TO app_public_resolver;
--> statement-breakpoint
GRANT SELECT (id, name) ON products TO app_public_resolver;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON attribute_definitions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON attribute_options
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON brands
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_serials
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_variants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenant_price_policies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON attribute_definitions
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON attribute_options
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON brands
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON category_attributes
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON product_images
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON product_lots
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON product_price_history
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON product_serials
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON product_variants
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON tenant_price_policies
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint

-- Initial measurement_units catalog — database.md#dynamic-attributes-governance-for-the-catalog-jsonb.
-- Migration-managed platform data, same pattern as permissions. Idempotent.
INSERT INTO measurement_units (code, label, dimension) VALUES
	('kg', 'Kilogramos', 'weight'),
	('g', 'Gramos', 'weight'),
	('cm', 'Centimetros', 'length'),
	('m', 'Metros', 'length'),
	('l', 'Litros', 'volume'),
	('ml', 'Mililitros', 'volume'),
	('cc', 'Centimetros cubicos', 'displacement'),
	('w', 'Watts', 'power'),
	('kw', 'Kilowatts', 'power')
ON CONFLICT (code) DO NOTHING;