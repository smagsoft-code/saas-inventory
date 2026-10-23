import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { NOTIFICATION_STATUS_FILTERS, ORDER_SORT_COLUMNS } from '../../repositories/order-column-filters';
import { CALENDAR_DATE_PATTERN } from '../../../common/reporting/local-day-range';

/** Exported for reuse by `apps/api/src/reports/sales/dto/sales-summary-query.dto.ts` — the real
 * order status enum, not redefined (modules.md: Reports --> Sales is an allowed dependency). */
export const ORDER_STATUSES = ['draft', 'pending', 'confirmed', 'fulfilled', 'cancelled'] as const;
export const DOCUMENT_TYPES = ['invoice', 'sales_note'] as const;

/** Offset pagination + explicit documented filters only (api.md). This is a transactional
 * operational list, not a reporting endpoint (§82) — no aggregation, no cross-domain joins. */
export class ListOrdersQueryDto {
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

  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number];

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'orders.location_id equality filter (Almacén).' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'orders.placed_by_user_id — only the orders of this seller. Honoured only for callers holding sales.orders.view_all; everyone else is always scoped to their own orders.' })
  @IsOptional()
  @IsUUID()
  placedByUserId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Only orders placed at a location (Almacén) of this warehouse (Sucursal).' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ type: String, maxLength: 120, description: 'One search box: order number, customer name or seller name (substring).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

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

  @ApiPropertyOptional({ type: String, maxLength: 120, description: 'Substring of the seller\'s full name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 30, description: 'Substring of the order total (as text).' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  total?: string;

  @ApiPropertyOptional({ enum: NOTIFICATION_STATUS_FILTERS, description: 'Rolled-up notification status of the order.' })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUS_FILTERS)
  notificationStatus?: (typeof NOTIFICATION_STATUS_FILTERS)[number];

  @ApiPropertyOptional({ enum: ORDER_SORT_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ORDER_SORT_COLUMNS)
  sort?: (typeof ORDER_SORT_COLUMNS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: (typeof DOCUMENT_TYPES)[number];

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({
    type: String,
    example: '2026-10-13',
    description:
      'Business-day filter (YYYY-MM-DD, tenant timezone), whole day inclusive. When present it takes precedence over createdFrom/createdTo.',
  })
  @IsOptional()
  @Matches(CALENDAR_DATE_PATTERN, { message: 'dateFrom must be a YYYY-MM-DD calendar date' })
  dateFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '2026-10-13',
    description: 'Last business day, inclusive (YYYY-MM-DD, tenant timezone). Defaults to dateFrom; requires dateFrom.',
  })
  @IsOptional()
  @Matches(CALENDAR_DATE_PATTERN, { message: 'dateTo must be a YYYY-MM-DD calendar date' })
  dateTo?: string;
}
