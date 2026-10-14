import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CartItemResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  productVariantId!: string;

  @ApiProperty({ type: String, format: 'uuid', description: 'The parent product — lets the UI fetch its images (GET /products/:productId/images) for a line thumbnail.' })
  productId!: string;

  @ApiProperty({ type: String })
  sku!: string;

  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiPropertyOptional({ type: Number, description: 'Vendor-proposed unit price, if a negotiation was recorded on this line.' })
  negotiatedUnitPrice?: number;

  @ApiProperty({ type: Number, description: 'Effective unit price = negotiatedUnitPrice ?? live basePrice.' })
  unitPrice!: number;

  @ApiProperty({ type: Number, description: 'unitPrice * quantity.' })
  lineSubtotal!: number;

  @ApiProperty({ type: Number, description: 'Live max (reference) price of the variant.' })
  maxPrice!: number;

  @ApiProperty({ type: Number, description: 'Live base (suggested) price of the variant.' })
  basePrice!: number;

  @ApiPropertyOptional({ type: Number, description: 'Live min (floor) price — present only for callers with pricing.floor.view.' })
  minPrice?: number;

  @ApiProperty({ type: Boolean, description: 'Whether the variant is currently sellable (status = active) and not serialized/lot-tracked.' })
  sellable!: boolean;

  @ApiProperty({ type: Number, description: 'Available stock for this variant at the cart location (physical - reserved - committed).' })
  availableAtLocation!: number;
}

export class CartResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['open', 'checked_out', 'abandoned'] })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  locationId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  customerId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'The order this cart produced, once checked out.' })
  orderId?: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items!: CartItemResponseDto[];

  @ApiProperty({ type: Number, description: 'Sum of every line subtotal — server-computed.' })
  subtotal!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
