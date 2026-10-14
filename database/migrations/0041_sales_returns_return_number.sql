-- Sales returns get a human-readable, per-tenant sequential code (`DEV-001`, `DEV-002`, ... and
-- `DEV-1000` once past 999 — three digits is a minimum, never a cap). Added nullable first so the
-- rows that already exist can be numbered in creation order, then tightened to NOT NULL + unique
-- per tenant (a plain `ADD COLUMN ... NOT NULL` fails against any tenant that already has returns —
-- same backfill-then-constrain shape as 0035_inventory_transfers_code). New rows are numbered by
-- `SalesReturnsRepository.nextReturnNumber` (advisory lock + `count(*) + 1` per tenant, the pattern
-- `OrdersRepository.nextOrderNumber` established), so a tenant continues exactly where this
-- backfill leaves it — never a duplicate, never a gap.
ALTER TABLE "sales_returns" ADD COLUMN "return_number" text;--> statement-breakpoint

-- RLS note (mirrors 0035/0029): sales_returns has ENABLE + FORCE ROW LEVEL SECURITY and
-- app_migrator's table ownership does not bypass FORCE, so without this the UPDATE below would
-- match zero rows and SET NOT NULL would then fail on any populated database. FORCE is toggled off
-- only for this backfill, inside the single transaction Drizzle wraps this whole file in (no other
-- session observes the intermediate state), and is unconditionally restored before commit.
ALTER TABLE "sales_returns" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

WITH numbered AS (
	SELECT
		"id",
		"tenant_id",
		'DEV-' || CASE
			WHEN row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") < 1000
				THEN lpad((row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id"))::text, 3, '0')
			ELSE (row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id"))::text
		END AS new_number
	FROM "sales_returns"
)
UPDATE "sales_returns" sr
SET "return_number" = numbered.new_number
FROM numbered
WHERE numbered.id = sr.id AND numbered.tenant_id = sr.tenant_id;--> statement-breakpoint

ALTER TABLE "sales_returns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "sales_returns" ALTER COLUMN "return_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_tenant_return_number_key" UNIQUE("tenant_id","return_number");
