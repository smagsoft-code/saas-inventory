import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

/**
 * Bucket shapes for `GET /reports/returns-summary` (F18-04). Each carries only the fields that are
 * safe to sum across every bucket of its own kind — the same rule `SalesSummaryResponseDto`
 * documents. A period/customer bucket is return-level (`returnCount`/`orderCount` are each a
 * distinct count, never inflated by the return→line→order_item join — `COUNT(DISTINCT ...)`,
 * per this phase's cardinality rule). A product bucket carries `orderCount` too (distinct orders
 * containing a return line for that product) but, like `SalesProductBucketDto`, is not meant to be
 * summed into a page-wide "orders" KPI (a multi-product return appears once per product).
 *
 * The disposition bucket deliberately has **no `returnCount`** — a single return can carry lines
 * with more than one disposition (ADR-0021 fixes one disposition per *line*, not per return), so a
 * return legitimately appears in more than one disposition bucket. `lineCount`/`quantity`/
 * `returnedValue` stay safe to sum across disposition buckets (each return *line* belongs to
 * exactly one disposition), which is why only `returnCount` is omitted here.
 */
export class ReturnsPeriodBucketDto {
  @ApiProperty({ type: String, description: 'Tenant-local calendar date (YYYY-MM-DD) the period starts on.' })
  key!: string;

  @ApiProperty({ type: Number, description: 'Distinct sales_returns.id in this bucket.' })
  returnCount!: number;

  @ApiProperty({ type: Number, description: 'Distinct orders.id referenced by a return in this bucket.' })
  orderCount!: number;

  @ApiProperty({ type: Number, description: 'Σ sales_return_items rows (return lines) in this bucket.' })
  lineCount!: number;

  @ApiProperty({ type: Number, description: 'Σ sales_return_items.quantity_returned.' })
  quantity!: number;

  @ApiProperty({ type: Number, description: 'Σ (quantity_returned × order_items.unit_price_snapshot).' })
  returnedValue!: number;

  @ApiProperty({ type: Number, description: 'returnedValue ÷ returnCount.' })
  avgReturnValue!: number;
}

export class ReturnsCustomerBucketDto {
  @ApiProperty({ type: String, description: 'customers.id' })
  key!: string;

  @ApiProperty({ type: String, description: 'Frozen customer_name_snapshot from the most recent matching order.' })
  customerName!: string;

  @ApiProperty({ type: Number })
  returnCount!: number;

  @ApiProperty({ type: Number })
  orderCount!: number;

  @ApiProperty({ type: Number })
  lineCount!: number;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number })
  returnedValue!: number;

  @ApiProperty({ type: Number })
  avgReturnValue!: number;
}

export class ReturnsProductBucketDto {
  @ApiProperty({ type: String, description: 'product_variants.id' })
  key!: string;

  @ApiProperty({ type: String, description: 'Frozen sku_snapshot.' })
  sku!: string;

  @ApiProperty({ type: String, description: 'Frozen product_name_snapshot.' })
  productName!: string;

  @ApiProperty({ type: Number, description: 'Distinct returns containing a line for this product.' })
  returnCount!: number;

  @ApiProperty({ type: Number, description: 'Distinct orders containing a returned line for this product.' })
  orderCount!: number;

  @ApiProperty({ type: Number })
  lineCount!: number;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number })
  returnedValue!: number;
}

export class ReturnsDispositionBucketDto {
  @ApiProperty({ type: String, enum: ['restock', 'quarantine', 'damaged', 'scrap'] })
  key!: string;

  @ApiProperty({ type: Number, description: 'Σ sales_return_items rows with this disposition.' })
  lineCount!: number;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number })
  returnedValue!: number;
}

/**
 * The `ReportResult<T>` shape (F18-01) with the bucket type resolved per `groupBy`. `status` is not
 * echoed here, matching `SalesSummaryResponseDto`'s precedent (the applied filter is not part of
 * the result shape — only `from`/`to`/`timezone`/`groupBy` describe "what was queried").
 */
@ApiExtraModels(ReturnsPeriodBucketDto, ReturnsCustomerBucketDto, ReturnsProductBucketDto, ReturnsDispositionBucketDto)
export class ReturnsSummaryResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: string;

  @ApiProperty({ type: String, example: 'America/Bogota', description: "The tenant's IANA timezone, used to resolve day/week/month bucket boundaries." })
  timezone!: string;

  @ApiProperty({ type: String, example: 'USD', description: 'orders.currency — single-currency-per-tenant (FASE 12 default), echoed here rather than assumed by the frontend.' })
  currency!: string;

  @ApiProperty({ enum: ['day', 'week', 'month', 'product', 'customer', 'disposition'] })
  groupBy!: 'day' | 'week' | 'month' | 'product' | 'customer' | 'disposition';

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(ReturnsPeriodBucketDto) },
        { $ref: getSchemaPath(ReturnsCustomerBucketDto) },
        { $ref: getSchemaPath(ReturnsProductBucketDto) },
        { $ref: getSchemaPath(ReturnsDispositionBucketDto) },
      ],
    },
  })
  buckets!: (ReturnsPeriodBucketDto | ReturnsCustomerBucketDto | ReturnsProductBucketDto | ReturnsDispositionBucketDto)[];
}
