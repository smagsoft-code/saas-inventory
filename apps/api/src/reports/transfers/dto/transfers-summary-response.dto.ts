import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { TRANSFERS_SUMMARY_GROUP_BY } from './transfers-summary-query.dto';

/**
 * Bucket shapes for `GET /reports/transfers-summary` (F18-08). No monetary field anywhere — a
 * transfer moves stock between two locations of the same tenant; it has no price, cost or value
 * (`inventory_transfer_items` carries quantities only). Quantities only, same `NO COSTING` posture
 * as `inventory-summary` / `movements-summary`.
 *
 * `inTransitQuantity` — `Σ (inventory_transfer_items.quantity_dispatched −
 * inventory_transfer_items.quantity_received)` over items of transfers whose status is `dispatched`
 * or `partially_received`. This is `metrics.md` `TRF-INTRANSIT-QTY` / `kpis.md` `KPI-INV-INTRANSIT`
 * verbatim ("`Σ (dispatched − received)` over items of transfers in `dispatched`/`partially_received`").
 * The two per-item quantities are DB-`CHECK`-constrained `received <= dispatched <= requested`, so
 * the difference is always `>= 0` — never a negative "in transit".
 */
export class TransfersStatusBucketDto {
  @ApiProperty({ type: String, description: 'inventory_transfers.status' })
  key!: string;

  @ApiProperty({ type: Number, description: 'inventory_transfers rows in this status (COUNT(*), no item join — exact).' })
  transferCount!: number;
}

export class TransfersDestinationBucketDto {
  @ApiProperty({ type: String, description: 'inventory_transfers.destination_location_id' })
  key!: string;

  @ApiProperty({ type: String, description: 'locations.name for the destination.' })
  destinationName!: string;

  @ApiProperty({ type: Number, description: 'Σ (quantity_dispatched − quantity_received) over open-transfer items arriving here.' })
  inTransitQuantity!: number;

  @ApiProperty({ type: Number, description: 'COUNT(DISTINCT transfer id) of open transfers with this destination — never inflated by the item join.' })
  openTransferCount!: number;
}

export class TransfersVariantBucketDto {
  @ApiProperty({ type: String, description: 'inventory_transfer_items.product_variant_id' })
  key!: string;

  @ApiProperty({ type: String, description: 'product_variants.sku' })
  sku!: string;

  @ApiProperty({ type: String, description: 'products.name' })
  productName!: string;

  @ApiProperty({ type: Number, description: 'Σ (quantity_dispatched − quantity_received) for this variant across every open transfer.' })
  inTransitQuantity!: number;
}

/** `groupBy`-independent totals — the KPI row a grouped table alone cannot answer without a
 * client-side fold. Always computed from the item-grain query regardless of `groupBy`, so a
 * `groupBy=status` caller still gets the in-transit headline. */
export class TransfersSummaryTotalsDto {
  @ApiProperty({ type: Number, description: 'Σ (quantity_dispatched − quantity_received) over every open-transfer item, tenant-wide.' })
  inTransitQuantity!: number;

  @ApiProperty({ type: Number, description: 'COUNT of inventory_transfers with status dispatched or partially_received.' })
  openTransferCount!: number;
}

@ApiExtraModels(TransfersStatusBucketDto, TransfersDestinationBucketDto, TransfersVariantBucketDto)
export class TransfersSummaryResponseDto {
  /** Server clock at query time — an honest "as of now" marker for this live aggregate, never a
   * persisted historical snapshot (`GAP-SNAPSHOTS` stays open; this is not it — same as
   * `inventory-summary`'s `generatedAt`). */
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ enum: TRANSFERS_SUMMARY_GROUP_BY })
  groupBy!: (typeof TRANSFERS_SUMMARY_GROUP_BY)[number];

  @ApiProperty({ type: TransfersSummaryTotalsDto })
  totals!: TransfersSummaryTotalsDto;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(TransfersStatusBucketDto) },
        { $ref: getSchemaPath(TransfersDestinationBucketDto) },
        { $ref: getSchemaPath(TransfersVariantBucketDto) },
      ],
    },
  })
  buckets!: (TransfersStatusBucketDto | TransfersDestinationBucketDto | TransfersVariantBucketDto)[];
}
