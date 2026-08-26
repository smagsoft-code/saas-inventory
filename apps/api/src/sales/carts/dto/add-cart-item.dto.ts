import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';

/** Adds a variant to the cart, or increments its quantity if already present (upsert on
 * `(tenant_id, cart_id, product_variant_id)`, database.md#cart). The sellable entity is always a
 * `product_variant` (§18), never a bare product. `negotiatedUnitPrice`, when given, is the vendor's
 * proposed per-unit price — the backend still validates it against the variant's authorized range
 * at checkout (§24); it is never trusted as the final charged amount on its own. */
export class AddCartItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  productVariantId!: string;

  @ApiProperty({ type: Number, description: 'Quantity to add (must be > 0).' })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'Proposed negotiated unit price — validated server-side at checkout.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  negotiatedUnitPrice?: number;
}
