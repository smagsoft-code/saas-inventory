import { ApiProperty } from '@nestjs/swagger';

/** One `product_variants` row that currently has no active QR code — `GET /qr-codes/pending-variants`.
 * Deliberately minimal (no price fields): this list exists only to let an admin pick targets for
 * bulk QR generation, never to duplicate `product-catalog`'s own read model or its ADR-0028
 * price-field gating. */
export class PendingVariantResponseDto {
  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: String })
  variantId!: string;

  @ApiProperty({ type: String })
  sku!: string;
}
