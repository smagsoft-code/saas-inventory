import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ReportDateRangeQueryDto } from '../../../common/reporting/report-date-range.dto';

export const MOVEMENTS_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'type'] as const;
export type MovementsSummaryGroupBy = (typeof MOVEMENTS_SUMMARY_GROUP_BY)[number];

/** The real `inventory_movements.movement_type` enum (`inventory_movements_movement_type_check`,
 * migration 0005 / `05-inventory.ts:167`). `ListMovementsQueryDto`'s own `MOVEMENT_TYPES` constant
 * is not exported, so it is redeclared identically here rather than reaching into that operational
 * DTO's module — the same convention `ApprovalsSummaryQueryDto` / `ReturnsSummaryQueryDto` follow. */
export const MOVEMENTS_SUMMARY_TYPES = [
  'RECEIPT',
  'SALE',
  'RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'COMMITMENT',
  'COMMITMENT_RELEASE',
  'INITIAL_STOCK',
] as const;

/**
 * `GET /reports/movements-summary` (F18-07) — the aggregation half of `metrics.md`
 * `KPI-INV-MOVEMENTS` ("Movements in the period — `count` / `Σ quantity` by type, in range — day/
 * week/month/custom — filters: type, location, variant"). The date-range half
 * (`GAP-MOVEMENTS-DATE-FILTER`) was resolved on the operational list in F18-03; the server-side
 * `SUM`/`COUNT`/`GROUP BY` was left as "a FASE 18 aggregation item" by `MOV-QTY-BY-TYPE` /
 * `MOV-RECEIPTS-PERIOD` / `MOV-ADJUSTMENTS-PERIOD`.
 *
 * Extends the F18-01 `ReportDateRangeQueryDto` as-is — `from`/`to` stay `string | undefined` here
 * for the same `useDefineForClassFields` reason `SalesSummaryQueryDto` documents; **this report
 * requires both**, enforced by `MovementsReportService` (400 when either is missing). The range is
 * half-open `[from, to)` on `inventory_movements.occurred_at` — the canonical "when the physical
 * movement happened" timestamp (backdatable), the same column `GET /inventory/movements`'s
 * `occurredFrom`/`occurredTo` filter uses (F18-03), never `created_at`. Bucket boundaries for
 * `day`/`week`/`month` resolve in the tenant's own IANA timezone (server-side).
 *
 * `groupBy`:
 * - `day`/`week`/`month` — period buckets keyed by `occurred_at`.
 * - `type` — one bucket per real `movement_type` present in the range (`MOV-QTY-BY-TYPE`).
 *
 * `movementType` (optional filter) reuses the real 12-value enum; `locationId` / `productVariantId`
 * are the other two filters `KPI-INV-MOVEMENTS` names ("type, location, variant") — both real FK
 * columns on `inventory_movements`, matching `GET /inventory/movements`'s own filter set. Neither id
 * validates existence (same posture as `locationId` on `ListMovementsQueryDto` / `warehouseId` on
 * `InventorySummaryQueryDto`) — an id matching no row yields empty results. An invalid `movementType`
 * or `groupBy` is a 400 via `@IsIn`, never silently ignored.
 *
 * **Scope is tenant-wide** — matching the real, current behaviour of `GET /inventory/movements` and
 * `GET /reports/inventory-summary` (neither is restricted by `user_location_assignments`; ADR-0024's
 * guard only ever gates a write-path *action*, never a read — the discrepancy F18-03 corrected in
 * `filters-periods-and-scope.md`).
 */
export class MovementsSummaryQueryDto extends ReportDateRangeQueryDto {
  @ApiPropertyOptional({ enum: MOVEMENTS_SUMMARY_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(MOVEMENTS_SUMMARY_GROUP_BY)
  groupBy: MovementsSummaryGroupBy = 'day';

  @ApiPropertyOptional({ enum: MOVEMENTS_SUMMARY_TYPES })
  @IsOptional()
  @IsIn(MOVEMENTS_SUMMARY_TYPES)
  movementType?: (typeof MOVEMENTS_SUMMARY_TYPES)[number];

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productVariantId?: string;
}
