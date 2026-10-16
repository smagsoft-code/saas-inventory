import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { ProductCatalogRow, ProductCatalogStatus, ProductCatalogStockFilter } from '../types/product-catalog';

/**
 * Server-side read for the redesigned product list (`GET /api/v1/reports/product-catalog`,
 * OUI-004, permission `products.view`). Variant-grain, paginated, with a real substring search
 * (`q`, ILIKE on product name OR variant SKU — never a full-name match) and three real filters:
 * `categoryId`, `status` (the variant's own `active`/`discontinued`), `stock`
 * (`'with'` = available quantity > 1, `'without'` = exactly 0). Lives under `lib/catalog/` — the
 * frontend's own screen-domain grouping — even though the backend route is under `/reports/`
 * (that placement is purely a backend module-boundary concern, `modules.md`'s
 * `Catalog -> Core`-only edge; see the endpoint's own doc comment).
 */
export interface ListProductCatalogQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  categoryId?: string;
  /** Exactly one variant (to resolve a variant id to its code/name). */
  variantId?: string;
  status?: ProductCatalogStatus;
  stock?: ProductCatalogStockFilter;
}

export async function listProductCatalog(query: ListProductCatalogQuery = {}): Promise<Paginated<ProductCatalogRow>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.q) {
    params['q'] = query.q;
  }
  if (query.categoryId) {
    params['categoryId'] = query.categoryId;
  }
  if (query.variantId) {
    params['variantId'] = query.variantId;
  }
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.stock) {
    params['stock'] = query.stock;
  }
  return serverApiFetch<Paginated<ProductCatalogRow>>('/api/v1/reports/product-catalog', { query: params });
}
