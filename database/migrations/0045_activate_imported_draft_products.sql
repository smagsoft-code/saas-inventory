-- Products created by an Excel import were inserted without a status, so the column default
-- ('draft') applied — unlike POST /products, whose owner decision is that a new product starts
-- 'active' (sellable straight away). A draft product is never offered in the sales cart nor in a
-- transfer's product picker, so imported products with stock were invisible there.
-- The import now sets 'active' (import-execution.service.ts); this brings the products it already
-- created in line. Narrow on purpose: only products still in 'draft' that an import created
-- (an `imported` `create` row of `import_job_rows` points at one of their variants). A product the
-- owner deliberately set back to draft through the UI is not an import-created row, so it is untouched
-- unless it also came from an import — and an import-created product can always be set to draft again.
--
-- RLS note (mirrors 0035/0041/0042/0043): these tables have ENABLE + FORCE ROW LEVEL SECURITY and
-- app_migrator's ownership does not bypass FORCE, so without toggling it the UPDATE would match zero
-- rows. FORCE is switched off only for this statement, inside the single transaction Drizzle wraps
-- this file in, and is unconditionally restored before commit.
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variants" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_job_rows" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "products" p
SET "status" = 'active'
WHERE p."status" = 'draft'
  AND p."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "product_variants" pv
    JOIN "import_job_rows" r ON r."tenant_id" = pv."tenant_id" AND r."matched_product_variant_id" = pv."id"
    WHERE pv."tenant_id" = p."tenant_id"
      AND pv."product_id" = p."id"
      AND r."status" = 'imported'
      AND r."match_action" = 'create'
  );--> statement-breakpoint

ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_job_rows" FORCE ROW LEVEL SECURITY;
