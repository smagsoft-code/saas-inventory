import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MovementResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  productVariantId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  locationId!: string;

  @ApiProperty({ type: String })
  movementType!: string;

  @ApiProperty({ type: Number, description: 'Signed, relative to the bucket it affects.' })
  quantity!: number;

  @ApiProperty({ type: Number, description: 'quantity_physical snapshot immediately after this movement.' })
  balanceAfter!: number;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Unit cost of this movement, only present for inbound types that carry one. Omitted entirely (not null) when the caller lacks pricing.cost.view.',
  })
  unitCost?: number;

  @ApiPropertyOptional({ type: String })
  referenceType?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  referenceId?: string;

  @ApiPropertyOptional({ type: String })
  reason?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Human-readable reference label for SALE ("Venta #ORD-000123") and TRANSFER_OUT/TRANSFER_IN ("Transferencia #xxxxxxxx"). Omitted for every other movement type — those already carry a plain `reason`.',
  })
  referenceLabel?: string;

  @ApiProperty({ type: String })
  actorType!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  actorId?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
