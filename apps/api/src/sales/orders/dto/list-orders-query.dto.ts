import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
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
