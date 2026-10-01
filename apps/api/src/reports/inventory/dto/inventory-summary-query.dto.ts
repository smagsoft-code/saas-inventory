import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const INVENTORY_SUMMARY_GROUP_BY = ['warehouse', 'category'] as const;
export type InventorySummaryGroupBy = (typeof INVENTORY_SUMMARY_GROUP_BY)[number];

/**
 * `GET /reports/inventory-summary` (F18-03). Unlike `SalesSummaryQueryDto` this does **not** extend
 * `ReportDateRangeQueryDto` — this report is a live snapshot of current `inventory_balances` state,
 * not a period aggregate; `inventory_balances` carries no history to bucket by day/week/month
 * (`GAP-SNAPSHOTS`, still open, explicitly out of scope here). There is no `from`/`to`.
 *
 * `warehouseId`, `categoryId` and `locationId` are independent filters that compose with either
 * `groupBy` value (e.g. `groupBy=category&warehouseId=...` narrows the category breakdown to one
 * warehouse) — all three are real FK columns reachable from `inventory_balances`
 * (`locations.warehouse_id`, `products.category_id`, `inventory_balances.location_id` itself),
 * matching `GET /products?categoryId=` and `GET /locations?warehouseId=`'s existing filter
 * convention. `locationId` (OUI-002/`S-HOME` redesign) is the finer-grained sibling of
 * `warehouseId` — a Sucursal (`warehouses`) holds several Almacenes (`locations`); this narrows to
 * exactly one Almacén rather than every Almacén under one Sucursal. Composing both at once (a
 * `locationId` outside the given `warehouseId`) simply yields empty/zeroed results, same as any
 * other mismatched filter pair. None validates existence (same posture as `locationId` on
 * `ListBalancesQueryDto` today) — an id that matches no row simply yields empty/zeroed results.
 *
 * `groupBy` defaults to `warehouse` — the more physically operational grouping (matches the
 * existing `/inventory` and `/inventory/movements` screens, which already offer a warehouse/location
 * filter chip but no category one).
 */
export class InventorySummaryQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'inventory_balances.location_id — narrows to one Almacén.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: INVENTORY_SUMMARY_GROUP_BY, default: 'warehouse' })
  @IsOptional()
  @IsIn(INVENTORY_SUMMARY_GROUP_BY)
  groupBy: InventorySummaryGroupBy = 'warehouse';
}
