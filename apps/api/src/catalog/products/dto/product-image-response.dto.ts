import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `product_images` row (OUI-006). Never `storageKey` — that is an opaque pointer into
 * `ObjectStorageService`'s bucket, resolved only when actually streaming the image back; `url` is
 * the same-origin path the frontend fetches instead (`GET /products/:productId/images/:id`),
 * mirroring the app's existing same-origin `/api` rewrite convention rather than a direct,
 * unauthenticated S3 URL.
 */
export class ProductImageResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  productId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  productVariantId?: string;

  @ApiProperty({ type: Number, description: 'Display order among this product\'s images, ascending.' })
  position!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String })
  url!: string;
}
