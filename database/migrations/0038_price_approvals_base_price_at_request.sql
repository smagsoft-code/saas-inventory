-- Owner policy change: the exceptional-discount trigger moves from "below min_price" to "below
-- base_price" (apps/api/src/sales/pricing/sales-pricing.service.ts). Existing price_approvals
-- rows never recorded base_price at request time, so this backfills it from the frozen
-- order_items.base_price_snapshot of the line the approval was filed against, then locks the
-- column NOT NULL — every new row always knows it up front.
ALTER TABLE "price_approvals" ADD COLUMN "base_price_at_request" numeric;--> statement-breakpoint
UPDATE "price_approvals" AS pa
SET "base_price_at_request" = oi."base_price_snapshot"
FROM "order_items" AS oi
WHERE oi."tenant_id" = pa."tenant_id" AND oi."id" = pa."order_item_id";--> statement-breakpoint
ALTER TABLE "price_approvals" ALTER COLUMN "base_price_at_request" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "price_approvals" ADD CONSTRAINT "price_approvals_base_price_at_request_check" CHECK ("price_approvals"."base_price_at_request" >= 0);
