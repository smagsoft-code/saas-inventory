import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  categoryId?: string | undefined;

  @ApiPropertyOptional({ type: String })
  brandId?: string | undefined;

  @ApiPropertyOptional({ type: String })
  supplierId?: string | undefined;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  description?: string | undefined;

  @ApiProperty({ enum: ['draft', 'active', 'discontinued'] })
  status!: string;

  @ApiPropertyOptional({ type: Number })
  warrantyMonths?: number | undefined;

  @ApiProperty({ type: 'object', additionalProperties: true })
  attributes!: Record<string, unknown>;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}
