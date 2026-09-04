/**
 * F18-03 — mirrors `GET /api/v1/reports/inventory-summary`'s real response shape
 * (`apps/api/src/reports/inventory/dto/inventory-summary-response.dto.ts`), the same "no field is
 * added that the endpoint does not send" convention as `lib/types/reports.ts` (F18-02) — `apps/web`
 * does not import backend DTOs at runtime, so the shape is mirrored here rather than imported.
 *
 * No monetary field anywhere (`GAP-COST` stays open — quantities only). No `from`/`to`/`timezone`
 * either: unlike the sales report, this is a live snapshot of current `inventory_balances`, not a
 * period aggregate (`GAP-SNAPSHOTS` stays open) — `generatedAt` is an honest "as of now" marker,
 * never a stored historical point.
 */

export const INVENTORY_SUMMARY_GROUP_BY = ['warehouse', 'category'] as const;
export type InventorySummaryGroupBy = (typeof INVENTORY_SUMMARY_GROUP_BY)[number];

export const INVENTORY_SUMMARY_GROUP_BY_LABELS: Record<InventorySummaryGroupBy, string> = {
  warehouse: 'Warehouse',
  category: 'Category',
};

export interface InventoryWarehouseBucket {
  key: string;
  warehouseName: string;
  availableQuantity: number;
  reservedQuantity: number;
  outOfStockCount: number;
}

export interface InventoryCategoryBucket {
  /** `products.category_id`, or the literal `'uncategorized'` sentinel — never an invented id. */
  key: string;
  categoryName: string;
  availableQuantity: number;
  reservedQuantity: number;
  outOfStockCount: number;
}

export type InventorySummaryBucket = InventoryWarehouseBucket | InventoryCategoryBucket;

export interface InventorySummaryTotals {
  availableQuantity: number;
  reservedQuantity: number;
  outOfStockCount: number;
}

export interface InventorySummary {
  generatedAt: string;
  groupBy: InventorySummaryGroupBy;
  totals: InventorySummaryTotals;
  buckets: InventorySummaryBucket[];
}

export function isCategoryBucket(bucket: InventorySummaryBucket): bucket is InventoryCategoryBucket {
  return 'categoryName' in bucket;
}
