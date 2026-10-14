import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { CALENDAR_DATE_PATTERN } from '../../../common/reporting/local-day-range';

const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/** Offset pagination + explicit documented filters only (api.md). Operational list, not reporting. */
export class ListPriceApprovalsQueryDto {
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

  @ApiPropertyOptional({ enum: APPROVAL_STATUSES })
  @IsOptional()
  @IsIn(APPROVAL_STATUSES)
  status?: (typeof APPROVAL_STATUSES)[number];

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: "The parent order's location (Almacén) equality filter." })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    type: String,
    example: '2026-10-13',
    description: 'Business-day filter on requested_at (YYYY-MM-DD, tenant timezone), whole final day inclusive.',
  })
  @IsOptional()
  @Matches(CALENDAR_DATE_PATTERN, { message: 'dateFrom must be a YYYY-MM-DD calendar date' })
  dateFrom?: string;

  @ApiPropertyOptional({ type: String, example: '2026-10-13', description: 'Last business day, inclusive. Defaults to dateFrom; requires dateFrom.' })
  @IsOptional()
  @Matches(CALENDAR_DATE_PATTERN, { message: 'dateTo must be a YYYY-MM-DD calendar date' })
  dateTo?: string;
}
