-- D-8E.26-B4.11 — a read-only, tenant-pinned PostgreSQL role for diagnosing the QA tenant (`qa-dev-tenant`). PREPARED, NOT APPLIED to any database.
--
-- WHY a new mechanism instead of reusing the RLS pattern of app_tenant: every existing tenant-isolation policy is
--   TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
-- and `app.tenant_id` is a session variable the connection itself sets (SET / set_config). A role that may run arbitrary SELECTs and whose rows
-- are filtered by a variable it can change could simply switch tenant. So app_qa_readonly gets NO policy that reads a variable. Its policies compare
-- tenant_id with a VIEW (qa_readonly_scope) that resolves the one tenant slug written below, in this file; the role cannot alter the view, the
-- policies or the tenants table, and a policy stores the view by OID, so a search_path trick cannot redirect it.
--
-- WHAT it can do: SELECT, only on the tables and columns listed below (column-level grants exclude credentials, tokens, public QR codes,
-- customer contact data, order customer snapshots and every cost / minimum-price figure: product_variants.cost and min_price, inventory_movements.unit_cost). Nothing else: no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, no CREATE, no
-- function EXECUTE beyond what PostgreSQL grants to PUBLIC, no BYPASSRLS, no membership in any role, no ownership. There is NO default privilege,
-- so a table created later is invisible to it until a migration grants it on purpose.
--
-- FAIL CLOSED: if no ACTIVE tenant has the slug, qa_readonly_scope is empty and every policy compares tenant_id with NULL — the role reads nothing.
-- The role is created NOLOGIN: this migration enables no access by itself. Enabling it (ALTER ROLE … LOGIN PASSWORD …, by a privileged operator,
-- password never in Git) is a separate, explicitly authorized step. See docs/security/qa-readonly-role.md.
--
-- Like 0019, creating a role needs CREATEROLE, which app_migrator deliberately lacks: RESET ROLE to the session login for that, then SET ROLE back.
RESET ROLE;
--> statement-breakpoint
DO $$
DECLARE
  v_oid oid;
  v_super boolean;
  v_bypass boolean;
BEGIN
  SELECT r.oid, r.rolsuper, r.rolbypassrls INTO v_oid, v_super, v_bypass FROM pg_catalog.pg_roles r WHERE r.rolname = 'app_qa_readonly';
  IF NOT FOUND THEN
    CREATE ROLE app_qa_readonly WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;
  ELSE
    -- Roles are cluster-wide: a second database of the same cluster legitimately finds the role created for the first. What is NOT acceptable is adopting a
    -- role that is more than this migration would have made it, so anything beyond a plain, unprivileged, member-less, object-less role is refused.
    IF v_super OR v_bypass THEN
      RAISE EXCEPTION 'role app_qa_readonly already exists with SUPERUSER or BYPASSRLS; refusing to adopt it';
    END IF;
    IF EXISTS (SELECT FROM pg_catalog.pg_auth_members m WHERE m.member = v_oid OR m.roleid = v_oid) THEN
      RAISE EXCEPTION 'role app_qa_readonly already exists with role memberships; refusing to adopt it';
    END IF;
    IF EXISTS (SELECT FROM pg_catalog.pg_class c WHERE c.relowner = v_oid)
       OR EXISTS (SELECT FROM pg_catalog.pg_namespace n WHERE n.nspowner = v_oid)
       OR EXISTS (SELECT FROM pg_catalog.pg_proc p WHERE p.proowner = v_oid) THEN
      RAISE EXCEPTION 'role app_qa_readonly already exists and owns objects in this database; refusing to adopt it';
    END IF;
    -- LOGIN (enabled on purpose for another database of the cluster) is left as it is; everything dangerous is put back.
    ALTER ROLE app_qa_readonly WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;
  END IF;
END
$$;
--> statement-breakpoint
-- Defence in depth only (a role can override its own settings): the real barrier is the absence of write privileges.
ALTER ROLE app_qa_readonly SET default_transaction_read_only = on;
--> statement-breakpoint
ALTER ROLE app_qa_readonly SET statement_timeout = '30s';
--> statement-breakpoint
ALTER ROLE app_qa_readonly SET idle_in_transaction_session_timeout = '60s';
--> statement-breakpoint
SET ROLE app_migrator;
--> statement-breakpoint

-- The scope. security_barrier: a function the caller puts in WHERE must not run on rows the view has not filtered yet (the classic leak of a plain view).
-- app_qa_readonly reads these two views and nothing from `tenants` itself.
CREATE VIEW qa_readonly_scope WITH (security_barrier = true) AS
  SELECT t.id AS tenant_id FROM tenants t WHERE t.slug = 'qa-dev-tenant' AND t.status = 'active';
--> statement-breakpoint
CREATE VIEW qa_readonly_tenant WITH (security_barrier = true) AS
  SELECT t.id, t.name, t.slug, t.status FROM tenants t WHERE t.slug = 'qa-dev-tenant';
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON qa_readonly_scope, qa_readonly_tenant TO app_qa_readonly;
--> statement-breakpoint

-- Row access: one SELECT-only policy per table, pinned to the scope view (never to a session variable).
CREATE POLICY "tenant_settings_qa_readonly_select" ON "tenant_settings" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "users_qa_readonly_select" ON "users" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "roles_qa_readonly_select" ON "roles" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "user_roles_qa_readonly_select" ON "user_roles" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "role_permissions_qa_readonly_select" ON "role_permissions" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "user_location_assignments_qa_readonly_select" ON "user_location_assignments" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "categories_qa_readonly_select" ON "categories" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "products_qa_readonly_select" ON "products" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "product_variants_qa_readonly_select" ON "product_variants" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "product_images_qa_readonly_select" ON "product_images" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "qr_codes_qa_readonly_select" ON "qr_codes" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "warehouses_qa_readonly_select" ON "warehouses" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "locations_qa_readonly_select" ON "locations" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "inventory_balances_qa_readonly_select" ON "inventory_balances" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "inventory_movements_qa_readonly_select" ON "inventory_movements" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "inventory_transfers_qa_readonly_select" ON "inventory_transfers" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "inventory_transfer_items_qa_readonly_select" ON "inventory_transfer_items" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "inventory_transfer_receipts_qa_readonly_select" ON "inventory_transfer_receipts" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "inventory_transfer_receipt_items_qa_readonly_select" ON "inventory_transfer_receipt_items" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "customers_qa_readonly_select" ON "customers" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "carts_qa_readonly_select" ON "carts" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "cart_items_qa_readonly_select" ON "cart_items" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "orders_qa_readonly_select" ON "orders" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "order_items_qa_readonly_select" ON "order_items" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "order_payments_qa_readonly_select" ON "order_payments" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "sales_returns_qa_readonly_select" ON "sales_returns" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint
CREATE POLICY "sales_return_items_qa_readonly_select" ON "sales_return_items" AS PERMISSIVE FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s));
--> statement-breakpoint

-- Column access. A table granted by columns cannot be read with SELECT * (permission denied) — by design.
GRANT SELECT ("id", "tenant_id", "timezone", "transfers_require_approval", "transfers_require_preparation", "created_at", "updated_at") ON "tenant_settings" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "email", "status", "last_login_at", "created_at", "updated_at", "deleted_at") ON "users" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "name", "is_system_default", "created_at", "updated_at", "deleted_at") ON "roles" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "user_roles" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "role_permissions" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "user_location_assignments" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "categories" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "category_id", "name", "status", "created_at", "updated_at", "deleted_at") ON "products" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "product_id", "sku", "barcode", "unit", "max_price", "base_price", "status", "is_serialized", "is_lot_tracked", "created_at", "updated_at", "deleted_at") ON "product_variants" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "product_id", "product_variant_id", "storage_key", "mime_type", "position", "created_at") ON "product_images" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "target_type", "target_id", "status", "expires_at", "created_at", "updated_at") ON "qr_codes" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "name", "code", "status", "created_at", "updated_at", "deleted_at") ON "warehouses" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "locations" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "inventory_balances" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "product_variant_id", "location_id", "movement_type", "quantity", "balance_after", "reference_type", "reference_id", "reason", "occurred_at", "created_at") ON "inventory_movements" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "code", "source_location_id", "destination_location_id", "status", "notes", "created_at", "updated_at", "approved_at", "dispatched_at", "received_at", "cancelled_at") ON "inventory_transfers" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "inventory_transfer_items" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "transfer_id", "created_at") ON "inventory_transfer_receipts" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "receipt_id", "transfer_item_id", "quantity_received", "incident_type", "created_at") ON "inventory_transfer_receipt_items" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "type", "first_name", "last_name", "display_name", "tax_id", "status", "created_at", "updated_at", "deleted_at") ON "customers" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "carts" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "cart_items" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "location_id", "customer_id", "order_number", "document_type", "invoice_status", "status", "subtotal", "discount_total", "tax_total", "total", "currency", "placed_by_user_id", "created_at", "updated_at") ON "orders" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "order_id", "product_variant_id", "sku_snapshot", "product_name_snapshot", "unit_price_snapshot", "quantity", "discount_amount", "is_exceptional_discount", "line_total", "created_at") ON "order_items" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ON "order_payments" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "return_number", "order_id", "location_id", "status", "reason", "created_at", "updated_at") ON "sales_returns" TO app_qa_readonly;
--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "return_id", "order_item_id", "product_variant_id", "quantity_returned", "disposition", "disposition_location_id", "created_at") ON "sales_return_items" TO app_qa_readonly;
