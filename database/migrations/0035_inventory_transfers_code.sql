-- Transferencias audit/implementation (see the delivered report): a human-readable, sequential
-- transfer code — `${sourceWarehouse.code}-${sourceLocation.code}-NNN` (e.g. "MATR-ALM-001") —
-- was entirely missing (`inventory_transfers` had no display code, only its UUID `id`).
--
-- Added nullable first, backfilled, THEN set NOT NULL + UNIQUE(tenant_id, code) — a plain
-- `ADD COLUMN ... NOT NULL` (drizzle-kit's default single-statement output for a `.notNull()`
-- field) fails outright against any tenant that already has transfer rows, same reasoning as
-- every other backfill-then-constrain migration in this directory (e.g. 0029_backfill_identities).
--
-- Backfill numbering: partitioned by (tenant_id, source_location_id), ordered by (created_at,
-- id) for a deterministic tie-break — the exact scope `InventoryTransfersRepository.nextTransferCode`
-- uses going forward (a `pg_advisory_xact_lock(hashtext(...))` + `count(*)` per source location,
-- the same concurrency-safe pattern `orders.repository.ts`'s `nextOrderNumber()` already
-- established), so a tenant with pre-existing transfers continues its per-location sequence from
-- exactly where this backfill leaves it — never a duplicate, never a gap.
ALTER TABLE "inventory_transfers" ADD COLUMN "code" text;--> statement-breakpoint

-- RLS note (mirrors 0029_backfill_identities.sql): inventory_transfers/locations/warehouses all
-- have ENABLE + FORCE ROW LEVEL SECURITY (migration 0007/0003), and app_migrator's table
-- ownership does not bypass FORCE. Toggling FORCE off for this one backfill statement is safe —
-- it runs inside the single transaction Drizzle wraps this whole file in, so no other session ever
-- observes the intermediate state, and FORCE is unconditionally restored below before commit.
ALTER TABLE inventory_transfers NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE locations NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE warehouses NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

WITH numbered AS (
	SELECT
		it.id,
		it.tenant_id,
		w.code || '-' || l.code || '-' || lpad(
			(row_number() OVER (PARTITION BY it.tenant_id, it.source_location_id ORDER BY it.created_at, it.id))::text,
			3,
			'0'
		) AS new_code
	FROM inventory_transfers it
	JOIN locations l ON l.tenant_id = it.tenant_id AND l.id = it.source_location_id
	JOIN warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
)
UPDATE inventory_transfers it
SET code = numbered.new_code
FROM numbered
WHERE numbered.id = it.id AND numbered.tenant_id = it.tenant_id;--> statement-breakpoint

ALTER TABLE inventory_transfers FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "inventory_transfers" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_tenant_id_code_key" UNIQUE("tenant_id","code");
