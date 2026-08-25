import { ApiProperty } from '@nestjs/swagger';

/**
 * `GET /qr-codes/resolve/:code` — the authenticated resolve path. Deliberately identity-only, never
 * pricing/stock: mobile.md#qr-on-mobile is explicit that the authenticated case is "looked up via
 * the same authenticated, permission-gated CATALOG endpoint any other product lookup uses... This is
 * not a request to the public QR resolver [and it needs] no mobile-specific pricing logic." QR's own
 * job is only to answer "what does this code point at" so the caller can then call the existing,
 * unmodified `GET /products/:productId/variants/:variantId` (ADR-0028's field-level price
 * authorization, already implemented, never duplicated here) or `GET /locations/:id`
 * (`locations.view`). `status` is the target row's own status (e.g. a discontinued variant or an
 * inactive location) — cheap, non-sensitive, lets a caller short-circuit without a second round trip.
 */
export class QrResolveIdentityResponseDto {
  @ApiProperty({ type: String })
  qrCodeId!: string;

  @ApiProperty({ enum: ['product_variant', 'location'] })
  targetType!: 'product_variant' | 'location';

  @ApiProperty({ type: String, description: 'Present when targetType is product_variant.', required: false })
  productVariantId?: string;

  @ApiProperty({ type: String, description: 'Present when targetType is product_variant — call GET /products/:productId/variants/:variantId next.', required: false })
  productId?: string;

  @ApiProperty({ type: String, description: 'Present when targetType is location — call GET /locations/:locationId next.', required: false })
  locationId?: string;

  @ApiProperty({ type: String })
  status!: string;
}
