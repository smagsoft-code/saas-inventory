import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * `GET /reports/kardex` — UI-UX-SPEC-001's Kardex. Unlike `MovementsSummaryQueryDto`,
 * `productVariantId` and `locationId` are both **required**: cost/average-cost math is only
 * well-defined for one (variant, location) pair at a time (a transfer can leave two locations with
 * different average costs for the same variant — see kardex-costing.ts), so there is no meaningful
 * "all locations at once" Kardex row the way there is for a location- or category-grouped summary.
 * The frontend resolves which location to query first (via `GET /inventory/balances`), the same
 * two-step navigation `[balanceId]/page.tsx` already uses today.
 *
 * `from`/`to` are both optional (unlike `MovementsSummaryQueryDto`, which requires both) — per
 * UI-UX-SPEC-001 §3, an absent bound means "no filter on that side", not a rejected request:
 * omitting both returns the variant's entire history at this location. Half-open `[from, to)` on
 * `occurred_at`, the same convention and column every other FASE 18 date filter uses.
 */
export class KardexQueryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  productVariantId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Inclusive lower bound of a half-open [from, to) period.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Exclusive upper bound of a half-open [from, to) period.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
