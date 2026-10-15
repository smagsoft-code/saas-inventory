-- Product and category names are now always stored in UPPERCASE (owner decision; new writes are
-- normalised by the catalog repositories). This brings the rows that already exist in line.
--
-- RLS note (mirrors 0035/0041/0042): both tables have ENABLE + FORCE ROW LEVEL SECURITY and
-- app_migrator's table ownership does not bypass FORCE, so without toggling it the UPDATEs would
-- match zero rows. FORCE is switched off only for these two statements, inside the single
-- transaction Drizzle wraps this file in (no other session observes the intermediate state), and is
-- unconditionally restored before commit. `upper()` follows the database locale; on a UTF-8 locale it
-- handles accents (ñ -> Ñ, á -> Á).
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "products" SET "name" = upper(btrim("name")) WHERE "name" IS DISTINCT FROM upper(btrim("name"));--> statement-breakpoint
UPDATE "categories" SET "name" = upper(btrim("name")) WHERE "name" IS DISTINCT FROM upper(btrim("name"));--> statement-breakpoint

ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
