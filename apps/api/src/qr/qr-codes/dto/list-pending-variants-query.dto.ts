import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * `GET /qr-codes/pending-variants` (bulk-generation candidate list) — bounded to a single page of
 * up to 100 (same convention as `list-qr-codes-query.dto.ts` and `ProductCatalogQueryDto`), never
 * a deep-pagination browse: this backs an admin "select which of these to generate" screen, not a
 * catalog. `q` is the same substring match (ILIKE on product name OR variant SKU) `ProductCatalogQueryDto`
 * already documents — no separate name/sku param.
 */
export class ListPendingVariantsQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 100, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 100;

  @ApiPropertyOptional({ type: String, description: 'Substring match on product name, variant SKU or category name (case-insensitive).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Only variants whose product belongs to this category.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
