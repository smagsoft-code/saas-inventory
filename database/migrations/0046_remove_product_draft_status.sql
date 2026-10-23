-- A product no longer has a "draft" state: it is created 'active' (sellable straight away — owner
-- decision) and can later be set 'discontinued'. The extra state only caused trouble: anything that
-- landed as 'draft' (e.g. every product created by an Excel import, before 0045) was silently excluded
-- from the sales cart and from the transfer pickers.
--
--  1. every remaining 'draft' product becomes 'active';
--  2. the column default becomes 'active' (it was the safe-fallback 'draft' for any insert path that
--     forgot to set a status — the root of the import bug);
--  3. the CHECK no longer allows 'draft', so it can never come back through any path.
--
-- RLS note (mirrors 0035/0041/0042/0043/0045): products has ENABLE + FORCE ROW LEVEL SECURITY and
-- app_migrator's ownership does not bypass FORCE, so without toggling it the UPDATE would match zero
-- rows — and the new CHECK would then fail on the untouched drafts. FORCE is switched off only for the
-- UPDATE, inside the single transaction Drizzle wraps this file in, and restored before commit.
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "products" SET "status" = 'active' WHERE "status" = 'draft';--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_status_check";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_status_check" CHECK ("products"."status" IN ('active', 'discontinued'));
