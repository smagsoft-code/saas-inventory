import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReturnItemResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  orderItemId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  productVariantId!: string;

  @ApiProperty({ type: Number })
  quantityReturned!: number;

  @ApiPropertyOptional({ enum: ['restock', 'quarantine', 'damaged', 'scrap'], description: 'Set at inspection.' })
  disposition?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  dispositionLocationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  inspectedBy?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  inspectedAt?: string;

  @ApiPropertyOptional({ type: String })
  notes?: string;
}

export class ReturnResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: String, format: 'uuid', description: 'Where the returned goods are received.' })
  locationId!: string;

  @ApiProperty({ enum: ['requested', 'inspecting', 'resolved', 'cancelled'] })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  requestedBy!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Who received the physical goods (set at inspection).' })
  receivedBy?: string;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: [ReturnItemResponseDto] })
  items!: ReturnItemResponseDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
