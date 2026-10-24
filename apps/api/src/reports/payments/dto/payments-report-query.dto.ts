import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { CALENDAR_DATE_PATTERN } from '../../../common/reporting/local-day-range';
import { DOCUMENT_TYPES } from '../../../sales/orders/dto/list-orders-query.dto';

export const PAYMENT_METHOD_FILTERS = ['cash', 'transfer', 'card', 'other'] as const;
export const PAYMENT_SORT_COLUMNS = ['createdAt', 'orderNumber', 'customer', 'seller', 'paymentMethod', 'amount', 'location', 'documentType'] as const;
export type PaymentSortColumn = (typeof PAYMENT_SORT_COLUMNS)[number];
export const PAYMENTS_EXPORT_FORMATS = ['xlsx', 'pdf'] as const;

/**
 * `GET /reports/payments` — the payment-method detail report. Same business-day semantics as the
 * sales history (`dateFrom`/`dateTo`, tenant timezone, whole final day inclusive), but the date
 * filtered is the **payment's** `created_at` (the confirmation instant), not the order's.
 */
export class PaymentsReportQueryDto {
  @ApiProperty({ type: String, example: '2026-10-13', description: 'First business day (YYYY-MM-DD, tenant timezone).' })
  @Matches(CALENDAR_DATE_PATTERN, { message: 'dateFrom must be a YYYY-MM-DD calendar date' })
  dateFrom!: string;

  @ApiPropertyOptional({ type: String, example: '2026-10-13', description: 'Last business day, inclusive. Defaults to dateFrom.' })
  @IsOptional()
  @Matches(CALENDAR_DATE_PATTERN, { message: 'dateTo must be a YYYY-MM-DD calendar date' })
  dateTo?: string;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'orders.location_id (Almacén).' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Only orders of a location (Almacén) of this warehouse (Sucursal).' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Only this seller — honoured only with sales.orders.view_all; everyone else sees their own.' })
  @IsOptional()
  @IsUUID()
  placedByUserId?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: (typeof DOCUMENT_TYPES)[number];

  @ApiPropertyOptional({ enum: PAYMENT_METHOD_FILTERS })
  @IsOptional()
  @IsIn(PAYMENT_METHOD_FILTERS)
  paymentMethod?: (typeof PAYMENT_METHOD_FILTERS)[number];

  @ApiPropertyOptional({ type: String, maxLength: 60, description: 'Substring of the order number.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  orderNumber?: string;

  @ApiPropertyOptional({ type: String, maxLength: 120, description: 'Substring of the (frozen) customer name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 120, description: "Substring of the seller's full name." })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 30, description: 'Substring of the payment amount (as text).' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  amount?: string;

  @ApiPropertyOptional({ enum: PAYMENT_SORT_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PAYMENT_SORT_COLUMNS)
  sort?: PaymentSortColumn;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}

export class PaymentsExportQueryDto extends PaymentsReportQueryDto {
  @ApiProperty({ enum: PAYMENTS_EXPORT_FORMATS })
  @IsIn(PAYMENTS_EXPORT_FORMATS)
  format!: (typeof PAYMENTS_EXPORT_FORMATS)[number];
}
