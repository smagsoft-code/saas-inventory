import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/**
 * Reusable `[from, to)` query pair for FASE 18 reporting endpoints (F18-01 — see
 * `date-range.ts` for the exact inclusive/exclusive semantics this pairs with). Both fields are
 * optional here: whether a given report requires both, defaults one when absent, or rejects an
 * absent one is that report's own decision, documented on its own DTO — this base only fixes the
 * *format* (`@IsDateString()`, matching the house style already used by
 * `apps/api/src/sales/orders/dto/list-orders-query.dto.ts`) and the *shared field names*, so every
 * report exposes the same two query params.
 *
 * A future report's own query DTO extends this, e.g.:
 * `export class SalesSummaryQueryDto extends ReportDateRangeQueryDto { groupBy!: ...; }`
 */
export class ReportDateRangeQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive lower bound of a half-open [from, to) period (ISO-8601 datetime, UTC).',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Exclusive upper bound of a half-open [from, to) period (ISO-8601 datetime, UTC).',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
