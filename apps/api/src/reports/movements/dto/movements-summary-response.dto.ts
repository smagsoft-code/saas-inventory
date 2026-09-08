import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { MOVEMENTS_SUMMARY_TYPES } from './movements-summary-query.dto';

/**
 * Bucket shapes for `GET /reports/movements-summary` (F18-07). `inventory_movements` is queried
 * **standalone** — one row is exactly one ledger movement, so `COUNT(*)` and `SUM(quantity)` are
 * exact with zero fan-out risk (no join, unlike the sales / returns reports).
 *
 * `totalQuantity` is the **signed** `Σ inventory_movements.quantity` — the column is stored signed
 * relative to the balance bucket it affects (`StockLedgerService`: RECEIPT / ADJUSTMENT_IN /
 * TRANSFER_IN / RETURN / RESERVATION / COMMITMENT / INITIAL_STOCK are positive; SALE /
 * ADJUSTMENT_OUT / TRANSFER_OUT / RESERVATION_RELEASE / COMMITMENT_RELEASE are negative). This is
 * `metrics.md` `MOV-QTY-BY-TYPE`'s "signed quantity by movement type" verbatim. For a `type` bucket
 * it is unambiguous (one movement type). For a `day`/`week`/`month` bucket with **no** `movementType`
 * filter it is a net across every movement type and every balance bucket in that period — set
 * `movementType` (e.g. `=RECEIPT` for `MOV-RECEIPTS-PERIOD`) or use `groupBy=type` for a
 * single-signed figure. `movementCount` (`MOV-COUNT`) is always meaningful.
 */
export class MovementsPeriodBucketDto {
  @ApiProperty({ type: String, description: 'Tenant-local calendar date (YYYY-MM-DD) the period starts on.' })
  key!: string;

  @ApiProperty({ type: Number, description: 'inventory_movements rows whose occurred_at falls in this bucket (after the filters).' })
  movementCount!: number;

  @ApiProperty({ type: Number, description: 'Signed Σ quantity over the rows in this bucket (see the class comment for sign semantics).' })
  totalQuantity!: number;
}

/**
 * A `type` bucket — one per real `inventory_movements.movement_type` present in the range (after the
 * filters). `key` is the movement type. `totalQuantity` is unambiguous here (all rows share a sign).
 */
export class MovementsTypeBucketDto {
  @ApiProperty({ type: String, enum: MOVEMENTS_SUMMARY_TYPES })
  key!: string;

  @ApiProperty({ type: Number, description: 'inventory_movements rows of this type whose occurred_at falls in the range.' })
  movementCount!: number;

  @ApiProperty({ type: Number, description: 'Signed Σ quantity over the rows of this type.' })
  totalQuantity!: number;
}

/**
 * The `ReportResult<T>` shape (F18-01) with the bucket type resolved per `groupBy`. No `currency`
 * field — this report carries no monetary value (unlike sales / returns / approvals summaries).
 * The applied filters (`movementType` / `locationId` / `productVariantId`) are not echoed — matching
 * `ApprovalsSummaryResponseDto` / `ReturnsSummaryResponseDto`: only `from`/`to`/`timezone`/`groupBy`
 * describe "what was queried". Swagger's `oneOf` documents the two possibilities; the real contract
 * is enforced by `MovementsReportService`.
 */
@ApiExtraModels(MovementsPeriodBucketDto, MovementsTypeBucketDto)
export class MovementsSummaryResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: string;

  @ApiProperty({ type: String, example: 'America/Bogota', description: "The tenant's IANA timezone, used to resolve day/week/month bucket boundaries." })
  timezone!: string;

  @ApiProperty({ enum: ['day', 'week', 'month', 'type'] })
  groupBy!: 'day' | 'week' | 'month' | 'type';

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [{ $ref: getSchemaPath(MovementsPeriodBucketDto) }, { $ref: getSchemaPath(MovementsTypeBucketDto) }],
    },
  })
  buckets!: (MovementsPeriodBucketDto | MovementsTypeBucketDto)[];
}
