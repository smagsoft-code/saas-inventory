import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `min_price` visibility rule (ADR-0028, §45 / test P15): `minPriceAtRequest` is present only for a
 * caller holding `pricing.floor.view`. `discountAmount` is computed against `max_price`
 * (`(maxPriceAtRequest - requestedPrice) * quantity`), not `min_price`, so it never lets a caller
 * without `pricing.floor.view` back out the floor. There is no `cost` field on `price_approvals`,
 * so §46/§98 (cost visibility) needs no handling here. `basePriceAtRequest` is always present
 * (never gated) — `base_price` is the actual exceptional-discount trigger (owner policy change),
 * so every caller who can see this request at all needs to see what threshold triggered it.
 */
export class PriceApprovalResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, description: 'Per-tenant sequential number of this approval (e.g. APR-001).' })
  approvalNumber!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: String, description: "The parent order's own human-readable number (e.g. ORD-000042) — resolved server-side, never derived from the id on screen." })
  orderNumber!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  orderItemId!: string;

  @ApiProperty({ type: String, format: 'uuid', description: "The parent order's location (Almacén)." })
  locationId!: string;

  @ApiPropertyOptional({ type: String, description: 'Frozen product name of the order line this request is about.' })
  productName?: string;

  @ApiPropertyOptional({ type: String, description: 'Frozen SKU of the order line.' })
  sku?: string;

  @ApiProperty({ type: Number, description: 'The requested (below-base-price) unit price — frozen from the order line.' })
  requestedPrice!: number;

  @ApiProperty({ type: Number, description: 'The variant max (reference) price at request time.' })
  maxPriceAtRequest!: number;

  @ApiProperty({ type: Number, description: 'The variant base (suggested) price at request time — the actual exceptional-discount trigger: requestedPrice < this is why approval was needed.' })
  basePriceAtRequest!: number;

  @ApiPropertyOptional({ type: Number, description: 'The variant hard floor at request time — present only for callers with pricing.floor.view.' })
  minPriceAtRequest?: number;

  @ApiProperty({ type: Number, description: '(maxPriceAtRequest - requestedPrice) * line quantity — informational.' })
  discountAmount!: number;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  requestedBy!: string;

  @ApiProperty({ type: String, description: "The requester's own display name, resolved server-side — never a raw id on screen." })
  requestedByName!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'The approver/rejecter — set once the request is resolved.' })
  approvedBy?: string;

  @ApiPropertyOptional({ type: String, description: 'The approver/rejecter\'s display name — present whenever `approvedBy` is.' })
  approvedByName?: string;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  requestedAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  resolvedAt?: string;
}
