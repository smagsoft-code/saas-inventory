import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, Min, ValidateIf } from 'class-validator';

/** Sets a cart line's absolute quantity and/or its negotiated unit price. `quantity` here is the
 * new absolute value (not a delta — deltas are only for "add the same variant again" via
 * POST /cart/items). Pass `negotiatedUnitPrice: null` to clear a previous negotiation and fall
 * back to the variant's live base price. */
export class UpdateCartItemDto {
  @ApiPropertyOptional({ type: Number, description: 'New absolute quantity (> 0).' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, description: 'New negotiated unit price, or null to clear it.' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsNumber()
  @Min(0)
  negotiatedUnitPrice?: number | null;
}
