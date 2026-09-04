import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const MOVEMENT_TYPES = [
  'RECEIPT',
  'SALE',
  'RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'COMMITMENT',
  'COMMITMENT_RELEASE',
  'INITIAL_STOCK',
] as const;

export class ListMovementsQueryDto {
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

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productVariantId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ enum: MOVEMENT_TYPES })
  @IsOptional()
  @IsIn(MOVEMENT_TYPES)
  movementType?: (typeof MOVEMENT_TYPES)[number];

  /**
   * `GAP-MOVEMENTS-DATE-FILTER` (F18-03). Filters on `inventory_movements.occurred_at` — the
   * canonical "when the physical movement happened" timestamp (backdatable), never `created_at`
   * ("when the row was written"). Half-open `[occurredFrom, occurredTo)`, same convention as every
   * FASE 18 reporting endpoint (`toHalfOpenRange()`) — `occurredFrom` is inclusive, `occurredTo` is
   * exclusive. Not named `from`/`to` (unlike `ReportDateRangeQueryDto`): this is an operational F17
   * list filter, not a FASE 18 report, and `occurred*` disambiguates from a future
   * `createdFrom`/`createdTo` on the same endpoint should one ever be added.
   */
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive lower bound on occurred_at (ISO-8601 datetime, half-open [occurredFrom, occurredTo)).',
  })
  @IsOptional()
  @IsDateString()
  occurredFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Exclusive upper bound on occurred_at (ISO-8601 datetime, half-open [occurredFrom, occurredTo)).',
  })
  @IsOptional()
  @IsDateString()
  occurredTo?: string;
}
