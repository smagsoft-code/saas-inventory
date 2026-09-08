import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const TRANSFERS_SUMMARY_GROUP_BY = ['status', 'destination', 'variant'] as const;
export type TransfersSummaryGroupBy = (typeof TRANSFERS_SUMMARY_GROUP_BY)[number];

/** The real `inventory_transfers.status` enum (`inventory_transfers_status_check`, migration 0006 /
 * `07-transfers.ts`). The two "in transit" statuses — a transfer that has been dispatched but not
 * yet fully received — are the fixed set that carries derived in-transit stock (ADR-0020,
 * `database.md#inventory-transfers-and-in-transit-stock`; also `metrics.md` `TRF-INTRANSIT-COUNT` /
 * `KPI-INV-INTRANSIT`). Not a client-supplied filter — it is intrinsic to what "in transit" means. */
export const TRANSFER_IN_TRANSIT_STATUSES = ['dispatched', 'partially_received'] as const;

/**
 * `GET /reports/transfers-summary` (F18-08 — "Transfer analytics"). Resolves the transfer read-side
 * items `docs/architecture/reporting/` left open:
 *
 * - `TRF-INTRANSIT-QTY` / `KPI-INV-INTRANSIT` / `REP-INV-INTRANSIT` (all **B** — "no cross-transfer
 *   aggregate"): `Σ (quantity_dispatched − quantity_received)` over `inventory_transfer_items` of
 *   transfers whose status is `dispatched` or `partially_received`, grouped **by destination or by
 *   variant** — the exact grouping `TRF-INTRANSIT-QTY` names.
 * - `TRF-OPEN-COUNT` / `TRF-INTRANSIT-COUNT` (both **B** — "5 separate calls today, or one
 *   aggregate"): a `status` rollup — `COUNT(*)` over `inventory_transfers` grouped by `status` — is
 *   "one aggregate".
 *
 * **No date range.** Like `GET /reports/inventory-summary` (F18-03), this is a live snapshot of
 * current open-transfer state, not a period query. `TRF-CYCLE-TIME` (which *would* need a period
 * anchor) is deliberately **not** built — its aggregation grain and period-anchor timestamp are
 * undefined in every reporting doc; inventing either is out of scope (see this phase's final report,
 * `GAP-TRANSFER-CYCLE-TIME`). `TRF-INCIDENTS` is likewise not built — `inventory_transfer_receipt_items`
 * is exposed by no endpoint and "incident analytics" has no defined metric.
 *
 * `groupBy`:
 * - `status` (default) — one bucket per real `inventory_transfers.status` present, `{ key, transferCount }`.
 *   `inventory_transfers` alone, `COUNT(*)`, zero fan-out.
 * - `destination` — in-transit stock by `destination_location_id`, name-resolved.
 * - `variant` — in-transit stock by `product_variant_id`, sku/name-resolved.
 *
 * **Scope is tenant-wide** — matching the real, current behaviour of `GET /inventory/transfers`,
 * `GET /inventory/balances` and `GET /inventory/movements` (none is restricted by
 * `user_location_assignments`; ADR-0024's guard only ever gates a write-path *action*, never a
 * read — the posture F18-03 corrected in `filters-periods-and-scope.md` and F18-07 reused).
 *
 * Permission: `inventory.view`, reused as-is (F18-01 — no `reports.*` family; the exact permission
 * every `TRF-*` / `KPI-INV-INTRANSIT` row in `metrics.md`/`kpis.md` already names).
 */
export class TransfersSummaryQueryDto {
  @ApiPropertyOptional({ enum: TRANSFERS_SUMMARY_GROUP_BY, default: 'status' })
  @IsOptional()
  @IsIn(TRANSFERS_SUMMARY_GROUP_BY)
  groupBy: TransfersSummaryGroupBy = 'status';
}
