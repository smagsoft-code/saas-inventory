import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

const PRODUCT_STATUSES = ['draft', 'active', 'discontinued'] as const;

export class UpdateProductDto {
  @ApiPropertyOptional({ type: String, description: 'An existing category id in the current tenant, or omit to leave unchanged.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Replaces the full PRODUCT-scope attributes object — validated against the (possibly new) categoryId (§33/§34).',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
