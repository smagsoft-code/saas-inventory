import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

/** `product_variants.status` — the real, existing 2-value enum (`product_variants_status_check`,
 * `03-catalog.ts`), reused as-is (never redefined against `products.status`, which is a *different*
 * 3-value enum — `draft`/`active`/`discontinued`). OUI-004 (`S-CAT-PRODUCTS` redesign) picks the
 * variant's own status here because every other field this endpoint returns (`sku`, prices, stock)
 * is variant-grain too — one row is one variant, not one product. */
export const PRODUCT_CATALOG_STATUSES = ['active', 'discontinued'] as const;
export type ProductCatalogStatus = (typeof PRODUCT_CATALOG_STATUSES)[number];

export const PRODUCT_CATALOG_STOCK_FILTERS = ['with', 'without', 'available'] as const;
export type ProductCatalogStockFilter = (typeof PRODUCT_CATALOG_STOCK_FILTERS)[number];

/**
 * `GET /reports/product-catalog` (OUI-004). This lives under REPORTS, not CATALOG, because it
 * joins `product_variants`/`products` (CATALOG) to `inventory_balances` (INVENTORY) for the stock
 * rollup — `modules.md`'s dependency rule keeps CATALOG on a single `Catalog -> Core` edge, so a
 * cross-domain read like this one is only ever built under REPORTS (the one module allowed
 * `Reports -> Catalog` + `Reports -> Inventory`), exactly like `reports/inventory-summary` already
 * does for its own product/category name enrichment. It is still the *operational* product list
 * (not a KPI dashboard) — `apps/web`'s `/products` page is its only real consumer.
 *
 * `q` is a plain substring match (`ILIKE '%...%'`, the same convention `CustomersRepository`
 * already uses) over `products.name` **or** `product_variants.sku` — never a full-name match
 * (OUI-004's explicit ask), never a separate `name`/`sku` param (one search box, either field).
 */
export class ProductCatalogQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ type: String, description: 'Substring match on product name, variant SKU or variant barcode (case-insensitive).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: "Count stock at this one location only (`availableQuantity` and the `stock` filter), instead of tenant-wide — what a sale made from that almacén can actually draw on.",
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Exactly one variant — lets a screen that only holds a variant id show its code/name.' })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiPropertyOptional({ enum: PRODUCT_CATALOG_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_CATALOG_STATUSES)
  status?: ProductCatalogStatus;

  @ApiPropertyOptional({
    enum: ['active', 'discontinued'],
    description: "The parent product's own status (as opposed to `status`, the variant's). The sales picker asks for `active` so a discontinued product never shows up for sale.",
  })
  @IsOptional()
  @IsIn(['active', 'discontinued'])
  productStatus?: 'active' | 'discontinued';

  @ApiPropertyOptional({
    enum: PRODUCT_CATALOG_STOCK_FILTERS,
    description: "'with' = total available quantity for this variant > 1. 'without' = exactly 0.",
  })
  @IsOptional()
  @IsIn(PRODUCT_CATALOG_STOCK_FILTERS)
  stock?: ProductCatalogStockFilter;
}
