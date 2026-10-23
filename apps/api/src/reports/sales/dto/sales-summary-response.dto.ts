import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { SALES_SUMMARY_EXCEPTIONAL } from './sales-summary-query.dto';

/**
 * Bucket shapes for `GET /reports/sales-summary` (F18-02). Each carries only the fields that make
 * sense for its own grouping (`ReportBucket`'s own rule, `packages/types`) — a product bucket has
 * no `avgTicket` ("ticket" is an order-level concept), a period/customer bucket has no per-line
 * `quantity`. All three share `key` (`ReportBucket`).
 */
export class SalesPeriodBucketDto {
  @ApiProperty({ type: String, description: 'Tenant-local calendar date (YYYY-MM-DD) the period starts on.' })
  key!: string;

  @ApiProperty({ type: Number })
  orderCount!: number;

  @ApiProperty({ type: Number })
  subtotal!: number;

  @ApiProperty({ type: Number })
  discountTotal!: number;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  avgTicket!: number;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Σ order_items.unit_cost_snapshot × quantity of the bucket\'s orders (frozen cost at sale time; lines without a snapshot count as 0 — see missingCostLines). Present only for callers holding pricing.cost.view (ADR-0028), absent otherwise — never a masked 0. Period groupings only.',
  })
  costTotal?: number;

  @ApiPropertyOptional({ type: Number, description: 'total − costTotal. Present only alongside costTotal.' })
  profit?: number;

  @ApiPropertyOptional({ type: Number, description: 'Order lines with no cost snapshot (counted as 0 in costTotal). Present only alongside costTotal.' })
  missingCostLines?: number;
}

export class SalesCustomerBucketDto {
  @ApiProperty({ type: String, description: 'customers.id' })
  key!: string;

  @ApiProperty({ type: String, description: 'Frozen customer_name_snapshot from the most recent matching order.' })
  customerName!: string;

  @ApiProperty({ type: Number })
  orderCount!: number;

  @ApiProperty({ type: Number })
  subtotal!: number;

  @ApiProperty({ type: Number })
  discountTotal!: number;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  avgTicket!: number;
}

export class SalesProductBucketDto {
  @ApiProperty({ type: String, description: 'product_variants.id' })
  key!: string;

  @ApiProperty({ type: String, description: 'Frozen sku_snapshot.' })
  sku!: string;

  @ApiProperty({ type: String, description: 'Frozen product_name_snapshot.' })
  productName!: string;

  @ApiProperty({ type: Number, description: 'Distinct orders containing this variant.' })
  orderCount!: number;

  @ApiProperty({ type: Number, description: 'Σ order_items.quantity.' })
  quantity!: number;

  @ApiProperty({ type: Number, description: 'Σ order_items.discount_amount.' })
  discountTotal!: number;

  @ApiProperty({ type: Number, description: 'Σ order_items.line_total.' })
  total!: number;
}

/**
 * The `ReportResult<T>` shape (`packages/types`, F18-01) with the bucket type resolved per
 * `groupBy`. Swagger cannot express "shape depends on a sibling field" natively — `oneOf` documents
 * the three possibilities; the real contract is enforced by `SalesReportService`, not by this class.
 */
@ApiExtraModels(SalesPeriodBucketDto, SalesCustomerBucketDto, SalesProductBucketDto)
export class SalesSummaryResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: string;

  @ApiProperty({ type: String, example: 'America/Bogota', description: "The tenant's IANA timezone, used to resolve day/week/month bucket boundaries." })
  timezone!: string;

  @ApiProperty({ type: String, example: 'USD', description: 'orders.currency — single-currency-per-tenant (FASE 12 default), echoed here rather than assumed by the frontend.' })
  currency!: string;

  @ApiProperty({ enum: ['day', 'week', 'month', 'product', 'customer'] })
  groupBy!: 'day' | 'week' | 'month' | 'product' | 'customer';

  @ApiProperty({
    enum: SALES_SUMMARY_EXCEPTIONAL,
    description:
      'The `exceptional` filter that was applied (F18-06), echoed back like `groupBy`. `all` = no filter; `only`/`exclude` filter by `order_items.is_exceptional_discount` (order grain for period/customer via EXISTS, line grain for product).',
  })
  exceptional!: (typeof SALES_SUMMARY_EXCEPTIONAL)[number];

  @ApiProperty({
    type: 'array',
    items: { oneOf: [{ $ref: getSchemaPath(SalesPeriodBucketDto) }, { $ref: getSchemaPath(SalesCustomerBucketDto) }, { $ref: getSchemaPath(SalesProductBucketDto) }] },
  })
  buckets!: (SalesPeriodBucketDto | SalesCustomerBucketDto | SalesProductBucketDto)[];
}
