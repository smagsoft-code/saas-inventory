-- Prompt 09 (QR, roadmap.md FASE 9): closes a real, pre-existing gap between database.md's
-- documented design and what earlier migrations actually created.
--
-- database.md#row-level-security's roles table and database.md#qr-codes both already described
-- app_public_resolver as needing read access to `products`/`product_variants`/`locations` to render
-- a public QR-scan response. Migration 0003 gave it the column-level GRANTs for `products`/
-- `product_variants` (SELECT (id, name) / SELECT (id, tenant_id, product_id, max_price, status)),
-- but RLS defaults to deny when zero permissive policies name the querying role for a command —
-- and no CREATE POLICY naming app_public_resolver on either table was ever written until now. The
-- public QR resolver (GET /q/:code) could therefore never actually read a product row: the GRANT
-- alone was necessary but not sufficient. `locations` had neither the policy nor the GRANT.
--
-- The three CREATE POLICY statements below (drizzle-kit generated, from
-- apps/api/src/database/schema/03-catalog.ts / 05-inventory.ts) close the policy half of the gap for
-- all three tables. The GRANT below closes the remaining half for `locations` only — `products`/
-- `product_variants` already have theirs from migration 0003, and are not re-granted here (GRANT is
-- additive/idempotent, but repeating an unrelated table's grant in this file would misstate what
-- this migration actually changes).
CREATE POLICY "product_variants_public_resolve" ON "product_variants" AS PERMISSIVE FOR SELECT TO "app_public_resolver" USING ("product_variants"."deleted_at" IS NULL);--> statement-breakpoint
CREATE POLICY "products_public_resolve" ON "products" AS PERMISSIVE FOR SELECT TO "app_public_resolver" USING ("products"."deleted_at" IS NULL);--> statement-breakpoint
CREATE POLICY "locations_public_resolve" ON "locations" AS PERMISSIVE FOR SELECT TO "app_public_resolver" USING ("locations"."deleted_at" IS NULL);
--> statement-breakpoint

-- Column-level GRANT mirroring migration 0003's products/product_variants grants exactly (same
-- "narrow, explicit column list, never SELECT *" shape) — the minimal set QR's location public
-- resolution needs to render a response (name/code/status), plus tenant_id for the application
-- layer's own defense-in-depth checks (never returned in the public HTTP response body itself).
GRANT SELECT (id, tenant_id, name, code, status) ON locations TO app_public_resolver;
