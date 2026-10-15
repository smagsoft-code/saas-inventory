import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '../../database/tenant-context';
import type { ProductCatalogStatus, ProductCatalogStockFilter } from './dto/product-catalog-query.dto';

/** A plain type alias (not `interface`) — `Database['execute']`'s generic bound requires
 * `Record<string, unknown>`, the same reason every other raw-SQL report repository in this
 * codebase (`InventoryReportRepository`, `TransfersReportRepository`, ...) inlines its row shape.
 * `totalCount` rides on every row via `COUNT(*) OVER()` — one round trip instead of a second
 * `COUNT(*)` query re-running the same joins/filters. */
export type ProductCatalogRow = {
  productId: string;
  productName: string;
  categoryId: string | null;
  variantId: string;
  sku: string;
  status: string;
  maxPrice: string;
  basePrice: string;
  availableQuantity: string;
  /** The product's first image (`product_images` ordered by `position`, then `created_at`) —
   * `null` when it has none yet (OUI-006). A `product_images` row (CATALOG-owned) joined here, not
   * a new endpoint or an N+1 per row — `Reports -> Catalog` is an already-allowed edge. */
  imageId: string | null;
  /** The product's attribute values merged with the variant's (variant wins on a shared code), keyed
   * by attribute code — raw JSONB; the client resolves names/units from the definitions. */
  attributes: Record<string, unknown> | null;
  totalCount: string;
};

export interface ProductCatalogFilters {
  q?: string | undefined;
  categoryId?: string | undefined;
  productStatus?: string | undefined;
  status?: ProductCatalogStatus | undefined;
  stock?: ProductCatalogStockFilter | undefined;
}

/**
 * `reports/products` read-side (OUI-004, OUI-006 added the thumbnail join) — a dedicated read
 * model over `product_variants` joined (never written) to `products` (name/category), a
 * `LEFT JOIN` stock rollup over `inventory_balances`, and a `LEFT JOIN LATERAL` against
 * `product_images` for one thumbnail per product (its first image by `position`) — one query, no
 * per-row fetch. Never `ProductsRepository`/`InventoryBalancesRepository`/`ProductImagesRepository`
 * — `modules.md`'s "reporting is a separate read-side" rule, the same as every other
 * `reports/<domain>/` repository. Raw parameterized `sql` (never string-interpolated) because this
 * shape (join + aggregate subquery + substring search + pagination) has no natural single
 * expression in the Drizzle query builder, the same reasoning `InventoryReportRepository` documents.
 *
 * Tenant scope: **tenant-wide** — matching `GET /inventory/balances`'s real, current behaviour
 * (never restricted by `user_location_assignments`; ADR-0024's guard only ever gates a write-path
 * action, never a read).
 */
@Injectable()
export class ProductsReportRepository {
  private whereClause(tenantId: string, filters: ProductCatalogFilters) {
    return sql`
      WHERE pv.tenant_id = ${tenantId}
        AND pv.deleted_at IS NULL
        AND p.deleted_at IS NULL
        ${filters.q ? sql`AND (p.name ILIKE '%' || ${filters.q} || '%' OR pv.sku ILIKE '%' || ${filters.q} || '%' OR pv.barcode ILIKE '%' || ${filters.q} || '%')` : sql``}
        ${filters.categoryId ? sql`AND p.category_id = ${filters.categoryId}` : sql``}
        ${filters.status ? sql`AND pv.status = ${filters.status}` : sql``}
        ${filters.productStatus ? sql`AND p.status = ${filters.productStatus}` : sql``}
        ${filters.stock === 'with' ? sql`AND COALESCE(stock.available_quantity, 0) > 1` : sql``}
        ${filters.stock === 'without' ? sql`AND COALESCE(stock.available_quantity, 0) = 0` : sql``}
    `;
  }

  async list(
    tx: TenantTransaction,
    tenantId: string,
    filters: ProductCatalogFilters,
    page: number,
    pageSize: number,
  ): Promise<ProductCatalogRow[]> {
    const offset = (page - 1) * pageSize;
    return tx.execute<ProductCatalogRow>(sql`
      SELECT
        p.id AS "productId",
        p.name AS "productName",
        p.category_id AS "categoryId",
        pv.id AS "variantId",
        pv.sku AS sku,
        pv.status AS status,
        pv.max_price AS "maxPrice",
        pv.base_price AS "basePrice",
        COALESCE(stock.available_quantity, 0) AS "availableQuantity",
        img.id AS "imageId",
        (COALESCE(p.attributes, '{}'::jsonb) || COALESCE(pv.attributes, '{}'::jsonb)) AS attributes,
        COUNT(*) OVER() AS "totalCount"
      FROM product_variants pv
      JOIN products p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
      LEFT JOIN (
        SELECT product_variant_id, SUM(quantity_available) AS available_quantity
        FROM inventory_balances
        WHERE tenant_id = ${tenantId}
        GROUP BY product_variant_id
      ) stock ON stock.product_variant_id = pv.id
      LEFT JOIN LATERAL (
        SELECT id
        FROM product_images
        WHERE product_images.tenant_id = ${tenantId} AND product_images.product_id = p.id
        ORDER BY position ASC, created_at ASC
        LIMIT 1
      ) img ON true
      ${this.whereClause(tenantId, filters)}
      ORDER BY p.name ASC, pv.sku ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
  }
}
