import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** minPrice/cost are omitted entirely (never null/masked) for a caller lacking
 * pricing.floor.view/pricing.cost.view (ADR-0028) — built by inclusion in ProductsService, never a
 * `{...row}` spread. */
export class VariantResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: String })
  sku!: string;

  @ApiPropertyOptional({ type: String })
  barcode?: string | undefined;

  @ApiProperty({ type: String })
  unit!: string;

  @ApiProperty({ type: Number })
  maxPrice!: number;

  @ApiProperty({ type: Number })
  basePrice!: number;

  @ApiPropertyOptional({ type: Number, description: 'Present only when the caller holds pricing.floor.view.' })
  minPrice?: number | undefined;

  @ApiPropertyOptional({ type: Number, description: 'Present only when the caller holds pricing.cost.view.' })
  cost?: number | undefined;

  @ApiProperty({ enum: ['active', 'discontinued'] })
  status!: string;

  @ApiProperty({ type: Boolean })
  isSerialized!: boolean;

  @ApiProperty({ type: Boolean })
  isLotTracked!: boolean;

  @ApiProperty({ type: 'object', additionalProperties: true })
  attributes!: Record<string, unknown>;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}
