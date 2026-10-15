import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One row of `GET /reports/product-catalog` (OUI-004) — one `product_variants` row, enriched with
 * its parent product's name/category and a tenant-wide stock rollup. `maxPrice`/`basePrice` are
 * never permission-gated (only `minPrice`/`cost` are, ADR-0028), so both are always present for any
 * caller with `products.view`. `categoryId` is omitted (not `null`) when the product has none —
 * the frontend resolves the name from its own bounded categories fetch, the same convention the
 * pre-existing `/products` list page already uses.
 */
export class ProductCatalogRowDto {
  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: String })
  productName!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  categoryId?: string;

  @ApiProperty({ type: String })
  variantId!: string;

  @ApiProperty({ type: String })
  sku!: string;

  @ApiProperty({ enum: ['active', 'discontinued'], description: 'product_variants.status.' })
  status!: string;

  @ApiProperty({ type: Number })
  maxPrice!: number;

  @ApiProperty({ type: Number })
  basePrice!: number;

  @ApiProperty({ type: Number, description: 'Σ inventory_balances.quantity_available for this variant, every location, tenant-wide.' })
  availableQuantity!: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Same-origin path to the product\'s first image (OUI-006), when it has one — GET /products/:productId/images/:imageId.',
  })
  thumbnailUrl?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Attribute values keyed by attribute code — the product\'s and the variant\'s merged (variant wins). Omitted when there are none.',
  })
  attributes?: Record<string, unknown>;
}
