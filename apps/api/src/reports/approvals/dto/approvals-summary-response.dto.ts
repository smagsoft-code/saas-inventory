import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

/**
 * Bucket shapes for `GET /reports/approvals-summary` (F18-05). Each carries only fields that are
 * safe to sum across every bucket of its own kind — the same rule `SalesSummaryResponseDto` /
 * `ReturnsSummaryResponseDto` document.
 *
 * `price_approvals` is queried **standalone** — one row is exactly one exceptional-discount request
 * for one order line, and `discount_amount` is a per-row frozen column (computed at request time
 * against `max_price`, never `min_price` — `metrics.md` `APPR-DISCOUNT-VALUE`, so it never leaks
 * the floor and needs no `pricing.floor.view`). There are **no joins**, so every `COUNT(*)` /
 * `COUNT(*) FILTER` / `SUM(discount_amount)` / `SUM(...) FILTER` is exact with zero fan-out risk.
 *
 * A period bucket (day/week/month) is request-level: it is the cohort of requests *filed* in that
 * period, with `approved`/`rejected`/`cancelled`/`pending` counts reflecting their **current**
 * status. `requestCount` == the sum of the four status counts.
 */
export class ApprovalsPeriodBucketDto {
  @ApiProperty({ type: String, description: 'Tenant-local calendar date (YYYY-MM-DD) the period starts on.' })
  key!: string;

  @ApiProperty({ type: Number, description: 'price_approvals rows whose requested_at falls in this bucket (all statuses).' })
  requestCount!: number;

  @ApiProperty({ type: Number, description: 'Of requestCount, how many are currently status = approved.' })
  approvedCount!: number;

  @ApiProperty({ type: Number, description: 'Of requestCount, how many are currently status = rejected.' })
  rejectedCount!: number;

  @ApiProperty({ type: Number, description: 'Of requestCount, how many are currently status = cancelled (order cancelled before resolution).' })
  cancelledCount!: number;

  @ApiProperty({ type: Number, description: 'Of requestCount, how many are still status = pending (no decision yet).' })
  pendingCount!: number;

  @ApiProperty({ type: Number, description: 'Σ discount_amount over the approved requests in this bucket (metrics.md APPR-DISCOUNT-VALUE).' })
  approvedDiscountValue!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'approvedCount / (approvedCount + rejectedCount), rounded to 4dp (metrics.md APPR-RATE). ' +
      'null when no request in the bucket has been decided yet (denominator 0) — cancelled and ' +
      'pending are excluded from the denominator (neither is a decision).',
  })
  approvalRate!: number | null;
}

/**
 * A `status` bucket — one per real `price_approvals.status`. No `approvalRate` (a single-status
 * bucket has no internal rate; a caller wanting the rate across statuses divides this grouping's
 * `approved` bucket count by `approved + rejected`). `discountValue` is `Σ discount_amount` for
 * *that* status — for the `approved` bucket it equals a period bucket's `approvedDiscountValue`
 * summed over the same range.
 */
export class ApprovalsStatusBucketDto {
  @ApiProperty({ type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  key!: string;

  @ApiProperty({ type: Number, description: 'price_approvals rows with this status whose requested_at falls in the range.' })
  requestCount!: number;

  @ApiProperty({ type: Number, description: 'Σ discount_amount over the rows in this bucket.' })
  discountValue!: number;
}

/**
 * The `ReportResult<T>` shape (F18-01) with the bucket type resolved per `groupBy`. `status` (the
 * applied filter) is not echoed — matching `SalesSummaryResponseDto`/`ReturnsSummaryResponseDto`:
 * only `from`/`to`/`timezone`/`groupBy` describe "what was queried".
 */
@ApiExtraModels(ApprovalsPeriodBucketDto, ApprovalsStatusBucketDto)
export class ApprovalsSummaryResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: string;

  @ApiProperty({ type: String, example: 'America/Bogota', description: "The tenant's IANA timezone, used to resolve day/week/month bucket boundaries." })
  timezone!: string;

  @ApiProperty({ type: String, example: 'USD', description: 'orders.currency — single-currency-per-tenant (FASE 12 default), echoed rather than assumed by the frontend.' })
  currency!: string;

  @ApiProperty({ enum: ['day', 'week', 'month', 'status'] })
  groupBy!: 'day' | 'week' | 'month' | 'status';

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [{ $ref: getSchemaPath(ApprovalsPeriodBucketDto) }, { $ref: getSchemaPath(ApprovalsStatusBucketDto) }],
    },
  })
  buckets!: (ApprovalsPeriodBucketDto | ApprovalsStatusBucketDto)[];
}
