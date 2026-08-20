CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity_physical" numeric DEFAULT '0' NOT NULL,
	"quantity_reserved" numeric DEFAULT '0' NOT NULL,
	"quantity_committed" numeric DEFAULT '0' NOT NULL,
	"quantity_available" numeric GENERATED ALWAYS AS ((quantity_physical - quantity_reserved - quantity_committed)) STORED,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_balances_tenant_variant_location_key" UNIQUE("tenant_id","product_variant_id","location_id"),
	CONSTRAINT "inventory_balances_physical_check" CHECK ("inventory_balances"."quantity_physical" >= 0),
	CONSTRAINT "inventory_balances_reserved_check" CHECK ("inventory_balances"."quantity_reserved" >= 0),
	CONSTRAINT "inventory_balances_committed_check" CHECK ("inventory_balances"."quantity_committed" >= 0),
	CONSTRAINT "inventory_balances_availability_check" CHECK ("inventory_balances"."quantity_reserved" + "inventory_balances"."quantity_committed" <= "inventory_balances"."quantity_physical")
);
--> statement-breakpoint
ALTER TABLE "inventory_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"quantity" numeric NOT NULL,
	"balance_after" numeric NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"reason" text,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"idempotency_key" text,
	"correlation_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_movements_movement_type_check" CHECK ("inventory_movements"."movement_type" IN ('RECEIPT', 'SALE', 'RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RESERVATION', 'RESERVATION_RELEASE', 'COMMITMENT', 'COMMITMENT_RELEASE', 'INITIAL_STOCK')),
	CONSTRAINT "inventory_movements_quantity_check" CHECK ("inventory_movements"."quantity" <> 0),
	CONSTRAINT "inventory_movements_actor_type_check" CHECK ("inventory_movements"."actor_type" IN ('user', 'system', 'platform_admin'))
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"parent_location_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_sellable" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "locations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "locations_tenant_warehouse_code_key" UNIQUE("tenant_id","warehouse_id","code"),
	CONSTRAINT "locations_status_check" CHECK ("locations"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "warehouses_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "warehouses_tenant_id_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "warehouses_status_check" CHECK ("warehouses"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_fk" FOREIGN KEY ("tenant_id","product_variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_fk" FOREIGN KEY ("tenant_id","parent_location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_balances_tenant_variant_idx" ON "inventory_balances" USING btree ("tenant_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_tenant_location_idx" ON "inventory_balances" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_tenant_idempotency_key" ON "inventory_movements" USING btree ("tenant_id","idempotency_key") WHERE "inventory_movements"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_variant_location_created_idx" ON "inventory_movements" USING btree ("tenant_id","product_variant_id","location_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_reference_idx" ON "inventory_movements" USING btree ("tenant_id","reference_type","reference_id") WHERE "inventory_movements"."reference_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_created_idx" ON "inventory_movements" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "inventory_balances_tenant_isolation" ON "inventory_balances" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "inventory_movements_tenant_isolation" ON "inventory_movements" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "locations_tenant_isolation" ON "locations" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "warehouses_tenant_isolation" ON "warehouses" AS PERMISSIVE FOR ALL TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "inventory_balances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- inventory_balances: materialized read model, updated in place under the SELECT ... FOR UPDATE
-- convoy (database.md#concurrency-strategy) — no DELETE, a balance row persists even at zero.
GRANT SELECT, INSERT, UPDATE ON inventory_balances TO app_tenant;
--> statement-breakpoint
-- inventory_movements: SOURCE OF TRUTH, append-only — immutable from the moment it's committed,
-- no UPDATE/DELETE grant at all (database.md#soft-delete-policy).
GRANT SELECT, INSERT ON inventory_movements TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON locations TO app_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON warehouses TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON inventory_balances, inventory_movements, locations, warehouses TO app_platform;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON inventory_balances
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON inventory_balances
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER prevent_tenant_id_change BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_change();