/**
 * Mirrors `GET /api/v1/reports/product-catalog` (OUI-004) —
 * `apps/api/src/reports/products/dto/product-catalog-response.dto.ts`. One row is one
 * `product_variants` row (never a product) enriched with its parent product's name/category and a
 * live, tenant-wide stock rollup. `maxPrice`/`basePrice` are never permission-gated (only
 * `minPrice`/`cost` are — ADR-0028).
 */

export const PRODUCT_CATALOG_STATUSES = ['active', 'discontinued'] as const;
export type ProductCatalogStatus = (typeof PRODUCT_CATALOG_STATUSES)[number];

export const PRODUCT_CATALOG_STOCK_FILTERS = ['with', 'without'] as const;
export type ProductCatalogStockFilter = (typeof PRODUCT_CATALOG_STOCK_FILTERS)[number];

export interface ProductCatalogRow {
  productId: string;
  productName: string;
  categoryId?: string;
  variantId: string;
  sku: string;
  status: string;
  maxPrice: number;
  basePrice: number;
  availableQuantity: number;
  /** Same-origin path to the product's first image (OUI-006), when it has one. */
  thumbnailUrl?: string;
}
