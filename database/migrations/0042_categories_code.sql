-- Categories: "slug" becomes "code" — a human-readable, per-tenant sequential code (`CAT-001`,
-- `CAT-002`, ... and `CAT-1000` once past 999: three digits is a minimum, never a cap), proposed
-- automatically but editable, and no longer restricted to lowercase. Uniqueness per tenant is now
-- case-insensitive (`CAT-001` and `cat-001` are the same code).
--
-- The column is RENAMED (not dropped/added) so no data is lost, then every existing category is
-- renumbered CAT-001... in creation order (per tenant; soft-deleted ones included so a code is never
-- reused), same backfill shape as 0035/0041. The old slug values are not kept: they were only ever
-- shown on the categories screen — nothing else (imports, products, SKUs) referenced them.
ALTER TABLE "categories" RENAME COLUMN "slug" TO "code";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_tenant_id_slug_key";--> statement-breakpoint

-- RLS note (mirrors 0035/0041): categories has ENABLE + FORCE ROW LEVEL SECURITY and app_migrator's
-- table ownership does not bypass FORCE, so the renumbering UPDATE would match zero rows without
-- this. FORCE is toggled off only for this backfill, inside the single transaction Drizzle wraps
-- this file in, and is unconditionally restored before commit.
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

WITH numbered AS (
	SELECT
		"id",
		"tenant_id",
		row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS n
	FROM "categories"
)
UPDATE "categories" c
SET "code" = 'CAT-' || CASE WHEN numbered.n < 1000 THEN lpad(numbered.n::text, 3, '0') ELSE numbered.n::text END
FROM numbered
WHERE numbered.id = c.id AND numbered.tenant_id = c.tenant_id;--> statement-breakpoint

ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE UNIQUE INDEX "categories_tenant_code_lower_key" ON "categories" USING btree ("tenant_id",lower("code"));
