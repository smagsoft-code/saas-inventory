import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `min_price` visibility rule (ADR-0028, §45 / test P15): `minPriceAtRequest` is present only for a
 * caller holding `pricing.floor.view`. `discountAmount` is computed against `max_price`
 * (`(maxPriceAtRequest - requestedPrice) * quantity`), not `min_price`, so it never lets a caller
 * without `pricing.floor.view` back out the floor. There is no `cost` field on `price_approvals`,
 * so §46/§98 (cost visibility) needs no handling here.
 */
export class PriceApprovalResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  orderItemId!: string;

  @ApiProperty({ type: Number, description: 'The requested (below-minimum) unit price — frozen from the order line.' })
  requestedPrice!: number;

  @ApiProperty({ type: Number, description: 'The variant max (reference) price at request time.' })
  maxPriceAtRequest!: number;

  @ApiPropertyOptional({ type: Number, description: 'The variant floor at request time — present only for callers with pricing.floor.view.' })
  minPriceAtRequest?: number;

  @ApiProperty({ type: Number, description: '(maxPriceAtRequest - requestedPrice) * line quantity — informational.' })
  discountAmount!: number;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  requestedBy!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'The approver/rejecter — set once the request is resolved.' })
  approvedBy?: string;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  requestedAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  resolvedAt?: string;
}
