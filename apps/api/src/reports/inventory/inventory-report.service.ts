import { Injectable } from '@nestjs/common';
import { withTenantTransaction } from '../../database/tenant-context';
import type {
  InventoryCategoryBucketDto,
  InventorySummaryResponseDto,
  InventoryWarehouseBucketDto,
} from './dto/inventory-summary-response.dto';
import type { InventorySummaryQueryDto } from './dto/inventory-summary-query.dto';
import type { InventoryCategoryBucketRow, InventoryTotalsRow, InventoryWarehouseBucketRow } from './inventory-report.repository';
import { InventoryReportRepository } from './inventory-report.repository';

const UNCATEGORIZED_KEY = 'uncategorized';
const UNCATEGORIZED_LABEL = 'Uncategorized';

function toNumber(value: string): number {
  return Number(value);
}

/** `canViewCost` decides field presence, not field masking (ADR-0028's existing precedent on
 * `VariantResponseDto` — built by inclusion, never a `{...row}` spread then stripped). A caller
 * without `pricing.cost.view` gets no `totalCostValue`/`missingCostCount` key at all. */
function toTotals(row: InventoryTotalsRow, canViewCost: boolean): InventorySummaryResponseDto['totals'] {
  const totals: InventorySummaryResponseDto['totals'] = {
    availableQuantity: toNumber(row.availableQuantity),
    reservedQuantity: toNumber(row.reservedQuantity),
    outOfStockCount: toNumber(row.outOfStockCount),
  };
  if (canViewCost) {
    totals.totalCostValue = toNumber(row.totalCostValue);
    totals.missingCostCount = toNumber(row.missingCostCount);
  }
  return totals;
}

/**
 * `GET /reports/inventory-summary` (F18-03). A live aggregate over current `inventory_balances`
 * state — never a stored snapshot (`GAP-SNAPSHOTS` stays open), never a client-side fold over raw
 * balance rows (that full-dataset-to-Node pattern is exactly what this endpoint replaces —
 * `GAP-INV-AGGREGATE`).
 */
@Injectable()
export class InventoryReportService {
  constructor(private readonly inventoryReportRepository: InventoryReportRepository) {}

  async getInventorySummary(
    tenantId: string,
    query: InventorySummaryQueryDto,
    canViewCost = false,
  ): Promise<InventorySummaryResponseDto> {
    const filters = { warehouseId: query.warehouseId, locationId: query.locationId, categoryId: query.categoryId };

    return withTenantTransaction(tenantId, async (tx) => {
      const [totalsRow, buckets] = await Promise.all([
        this.inventoryReportRepository.totals(tx, tenantId, filters),
        query.groupBy === 'category'
          ? this.inventoryReportRepository
              .summaryByCategory(tx, tenantId, filters)
              .then((rows) => rows.map(toCategoryBucket))
          : this.inventoryReportRepository
              .summaryByWarehouse(tx, tenantId, filters)
              .then((rows) => rows.map(toWarehouseBucket)),
      ]);

      return {
        generatedAt: new Date().toISOString(),
        groupBy: query.groupBy,
        totals: toTotals(totalsRow, canViewCost),
        buckets,
      };
    });
  }
}

function toWarehouseBucket(row: InventoryWarehouseBucketRow): InventoryWarehouseBucketDto {
  return {
    key: row.key,
    warehouseName: row.name,
    availableQuantity: toNumber(row.availableQuantity),
    reservedQuantity: toNumber(row.reservedQuantity),
    outOfStockCount: toNumber(row.outOfStockCount),
  };
}

/** A NULL `products.category_id` (no category assigned) maps to the explicit `'uncategorized'`
 * sentinel — never an invented UUID, never a silently dropped bucket (rule §"handle explicitly"). */
function toCategoryBucket(row: InventoryCategoryBucketRow): InventoryCategoryBucketDto {
  return {
    key: row.key ?? UNCATEGORIZED_KEY,
    categoryName: row.key === null ? UNCATEGORIZED_LABEL : row.name ?? UNCATEGORIZED_LABEL,
    availableQuantity: toNumber(row.availableQuantity),
    reservedQuantity: toNumber(row.reservedQuantity),
    outOfStockCount: toNumber(row.outOfStockCount),
  };
}
