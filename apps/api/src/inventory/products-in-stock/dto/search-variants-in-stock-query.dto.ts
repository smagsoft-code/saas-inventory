import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SearchVariantsInStockQueryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({ type: String, description: 'Case-insensitive partial match on the product name or the variant code (SKU).' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
