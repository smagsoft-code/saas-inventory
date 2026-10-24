import { ApiProperty } from '@nestjs/swagger';

export class VariantInStockResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  productId!: string;

  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  variantId!: string;

  @ApiProperty({ type: String, description: "The variant's code (SKU)." })
  sku!: string;

  @ApiProperty({ type: Number, description: 'Available quantity at the requested location (> 0).' })
  quantityAvailable!: number;
}
