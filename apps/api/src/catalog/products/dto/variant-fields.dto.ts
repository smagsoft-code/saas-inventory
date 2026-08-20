import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';

/** Shared field set for "the variant fields a create/update request can set" — embedded as
 * `defaultVariant` on CreateProductDto (ADR-0017: every product creates exactly one variant
 * alongside it) and reused, field-for-field, by CreateVariantDto for additional variants. Price
 * tier ordering (min <= base <= max) is checked by ProductsService against the same rule the
 * database CHECK enforces — a clean 400 before ever reaching Postgres's constraint error. */
export class VariantFieldsDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 80)
  sku!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  barcode?: string;

  @ApiPropertyOptional({ type: String, default: 'unit' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  unit?: string;

  @ApiProperty({ type: Number, minimum: 0, description: 'Reference/list price — shown on the QR.' })
  @IsNumber()
  @Min(0)
  maxPrice!: number;

  @ApiProperty({ type: Number, minimum: 0, description: 'Default suggested selling price.' })
  @IsNumber()
  @Min(0)
  basePrice!: number;

  @ApiProperty({ type: Number, minimum: 0, description: 'Floor before an exceptional-discount approval is required.' })
  @IsNumber()
  @Min(0)
  minPrice!: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'Requires pricing.cost.view to read back.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  isSerialized?: boolean;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  isLotTracked?: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'VARIANT-scope dynamic attributes, validated against the product\'s category (§33).',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
