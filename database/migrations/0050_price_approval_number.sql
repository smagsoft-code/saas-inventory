-- Human-readable, per-tenant sequential number for a price approval ("APR-001"), like
-- orders.order_number / sales_returns.return_number. Existing rows are numbered by request order.
-- RLS note (mirrors 0044/0049): price_approvals is FORCE ROW LEVEL SECURITY, so FORCE is switched
-- off only for the backfill, inside the single transaction Drizzle wraps this file in.
ALTER TABLE "price_approvals" ADD COLUMN "approval_number" text;--> statement-breakpoint
ALTER TABLE "price_approvals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "price_approvals" pa
SET "approval_number" = 'APR-' || lpad(n.rn::text, 3, '0')
FROM (
	SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY requested_at, id) AS rn
	FROM "price_approvals"
) n
WHERE pa.id = n.id;--> statement-breakpoint
ALTER TABLE "price_approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_approvals" ALTER COLUMN "approval_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "price_approvals" ADD CONSTRAINT "price_approvals_tenant_approval_number_key" UNIQUE ("tenant_id", "approval_number");
