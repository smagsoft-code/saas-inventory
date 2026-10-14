import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsUUID, Length, Min } from 'class-validator';

/**
 * Files an exceptional-discount approval request against a below-`base_price` order line (§47,
 * §50). Order-first: the line already exists (`order_items.is_exceptional_discount = true`), frozen
 * at checkout — the server derives `requestedPrice`/`minPriceAtRequest`/`maxPriceAtRequest` from
 * that row, never from the client (§50). `reason` is the one legitimately client-supplied field.
 *
 * `requestedPrice` is accepted only as an optional cross-check: when present it MUST equal the
 * order line's frozen `unit_price_snapshot`, otherwise the request is rejected (§92 / test P10) —
 * it is never used as the authority.
 */
export class CreatePriceApprovalDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'The order_items.id of the below-minimum line.' })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ type: String, minLength: 3, maxLength: 500, description: 'Why the exceptional discount is being requested.' })
  @Length(3, 500)
  reason!: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'Optional cross-check; must equal the order line price if provided.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  requestedPrice?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description:
      'Owner redesign: resubmitting after a rejection may propose a different price for the line before filing this new request — validated the same way checkout validates a negotiated price (max price ceiling, tenant hard floor). Omit to file against the price already on the line.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  newPrice?: number;
}
