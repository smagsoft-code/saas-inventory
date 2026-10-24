-- A confirmed order's date is now the instant its sale closed (OrdersService.confirm re-stamps
-- `orders.created_at` at confirmation; the original placement date goes to the audit log). This brings
-- the orders that were confirmed BEFORE that change in line: for every confirmed/fulfilled order that
-- has recorded payments, the date becomes the moment of its first payment — payments are written in
-- the same transaction as the confirmation, so that instant is the confirmation. Orders confirmed
-- before payments existed have no payment row and keep their date (nothing to derive it from).
--
-- The original date is not lost: one `order.confirmed.date_backfill` audit_log row per order keeps it
-- (same shape as the live `order.confirmed` entry: createdAt = placement, closedAt = confirmation).
-- The audit rows are written BEFORE the UPDATE (they read the still-original `created_at`), and only
-- for orders whose date actually changes, so re-running this file would be a no-op.
--
-- RLS note (mirrors 0035/0041-0045): these tables have ENABLE + FORCE ROW LEVEL SECURITY and
-- app_migrator's ownership does not bypass FORCE, so without toggling it the statements would match
-- zero rows. FORCE is switched off only for these statements, inside the single transaction Drizzle
-- wraps this file in, and is unconditionally restored before commit. `set_updated_at` is disabled for
-- the UPDATE only: re-dating a row is not an edit of the order, `updated_at` must stay as it was.
ALTER TABLE "orders" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_payments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" DISABLE TRIGGER "set_updated_at";--> statement-breakpoint

CREATE TEMP TABLE "_order_close_dates" ON COMMIT DROP AS
SELECT o."tenant_id", o."id" AS "order_id", o."created_at" AS "placed_at", MIN(p."created_at") AS "closed_at"
FROM "orders" o
JOIN "order_payments" p ON p."tenant_id" = o."tenant_id" AND p."order_id" = o."id"
WHERE o."status" IN ('confirmed', 'fulfilled')
GROUP BY o."tenant_id", o."id", o."created_at"
HAVING MIN(p."created_at") IS DISTINCT FROM o."created_at";--> statement-breakpoint

INSERT INTO "audit_log" ("tenant_id", "actor_type", "action_code", "entity_type", "entity_id", "after_state")
SELECT "tenant_id", 'system', 'order.confirmed.date_backfill', 'order', "order_id",
  jsonb_build_object(
    'status', 'confirmed',
    'createdAt', to_char("placed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'closedAt', to_char("closed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
FROM "_order_close_dates";--> statement-breakpoint

UPDATE "orders" o
SET "created_at" = d."closed_at"
FROM "_order_close_dates" d
WHERE o."tenant_id" = d."tenant_id" AND o."id" = d."order_id";--> statement-breakpoint

ALTER TABLE "orders" ENABLE TRIGGER "set_updated_at";--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
