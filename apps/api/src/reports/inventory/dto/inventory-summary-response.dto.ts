import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

/**
 * Bucket shapes for `GET /reports/inventory-summary` (F18-03). No monetary field on any bucket —
 * rule `NO COSTING`: `inventory_movements`/`inventory_balances` carry no cost themselves, and no
 * FIFO/weighted-average costing method exists. `totals` is the one exception (OUI-002/`S-HOME`
 * redesign, see `InventorySummaryTotalsDto`) — a **current-cost** valuation (Σ cost × available
 * quantity, `product_variants.cost` as-is right now), not a costing method; `GAP-COST` (the "no
 * historical costing method" gap) stays open, this only closes the narrower "no total value at
 * all" gap. Quantities only on every bucket.
 *
 * `outOfStockCount` — distinct variants whose available quantity, **summed across every balance
 * row inside this bucket**, is exactly 0 (`INV-ZERO-AVAILABLE`/`INV-OUT-OF-STOCK-SKUS`, adapted to
 * per-bucket scope — never a single `quantity_available = 0` row counted as a SKU, and never a
 * threshold: `quantity_available = 0` is the only objective, schema-backed definition of "out of
 * stock", per `GAP-REORDER`'s explicit "no invented threshold" rule). A variant that has **zero**
 * `inventory_balances` rows anywhere in the bucket (never stocked there) is not counted — this
 * report only aggregates rows that exist, same "no synthetic zero row" rule F18-02's customer
 * ranking already established for `GAP-CUSTOMER-HISTORY`.
 */
export class InventoryWarehouseBucketDto {
  @ApiProperty({ type: String, description: 'warehouses.id' })
  key!: string;

  @ApiProperty({ type: String })
  warehouseName!: string;

  @ApiProperty({ type: Number, description: 'Σ inventory_balances.quantity_available across every location in this warehouse.' })
  availableQuantity!: number;

  @ApiProperty({ type: Number, description: 'Σ inventory_balances.quantity_reserved across every location in this warehouse.' })
  reservedQuantity!: number;

  @ApiProperty({ type: Number, description: 'Distinct product_variant_id with 0 available quantity across this warehouse.' })
  outOfStockCount!: number;
}

export class InventoryCategoryBucketDto {
  @ApiProperty({ type: String, description: "products.category_id, or the literal 'uncategorized' when NULL — never an invented id." })
  key!: string;

  @ApiProperty({ type: String })
  categoryName!: string;

  @ApiProperty({ type: Number })
  availableQuantity!: number;

  @ApiProperty({ type: Number })
  reservedQuantity!: number;

  @ApiProperty({ type: Number })
  outOfStockCount!: number;
}

/** Tenant-wide totals for the applied `warehouseId`/`locationId`/`categoryId` filter, independent
 * of `groupBy` — the KPI row a grouped table alone cannot answer without a client-side fold. */
export class InventorySummaryTotalsDto {
  @ApiProperty({ type: Number })
  availableQuantity!: number;

  @ApiProperty({ type: Number })
  reservedQuantity!: number;

  @ApiProperty({ type: Number })
  outOfStockCount!: number;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Σ (product_variants.cost × availableQuantity) per variant, current cost only (never FIFO/weighted-average — GAP-COST). ' +
      'Present only when the caller holds pricing.cost.view (ADR-0028); omitted entirely otherwise, never masked as 0.',
  })
  totalCostValue?: number;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Distinct variants with available stock whose cost is not set — excluded from totalCostValue, so it is known-incomplete, ' +
      'never a silent undercount. Present only alongside totalCostValue.',
  })
  missingCostCount?: number;
}

@ApiExtraModels(InventoryWarehouseBucketDto, InventoryCategoryBucketDto)
export class InventorySummaryResponseDto {
  /** Server clock at query time — an honest "as of now" marker, never a persisted historical
   * snapshot (`GAP-SNAPSHOTS` stays open; this is not it). */
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ enum: ['warehouse', 'category'] })
  groupBy!: 'warehouse' | 'category';

  @ApiProperty({ type: InventorySummaryTotalsDto })
  totals!: InventorySummaryTotalsDto;

  @ApiProperty({
    type: 'array',
    items: { oneOf: [{ $ref: getSchemaPath(InventoryWarehouseBucketDto) }, { $ref: getSchemaPath(InventoryCategoryBucketDto) }] },
  })
  buckets!: (InventoryWarehouseBucketDto | InventoryCategoryBucketDto)[];
}
