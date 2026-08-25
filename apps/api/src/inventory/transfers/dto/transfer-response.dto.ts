import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferItemResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  productVariantId!: string;

  @ApiProperty({ type: Number })
  quantityRequested!: number;

  @ApiProperty({ type: Number })
  quantityDispatched!: number;

  @ApiProperty({ type: Number })
  quantityReceived!: number;

  /** Derived, never stored — database.md#inventory-transfers-and-in-transit-stock: "in transit" is
   * SUM(dispatched - received) over open transfer items, not a second balance bucket. */
  @ApiProperty({ type: Number })
  quantityInTransit!: number;
}

export class TransferResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceLocationId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationLocationId!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  requestedBy!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  approvedBy?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  dispatchedBy?: string;

  @ApiPropertyOptional({ type: String })
  notes?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  approvedAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  dispatchedAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  receivedAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  cancelledAt?: string;

  @ApiProperty({ type: [TransferItemResponseDto] })
  items!: TransferItemResponseDto[];
}
