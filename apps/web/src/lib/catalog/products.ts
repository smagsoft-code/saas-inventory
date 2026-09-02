import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { Product, Variant } from '../types/products';

/**
 * Server-side reads for products + variants (`GET /api/v1/products*`, permission `products.view`).
 * Client-side mutations (`POST`/`PATCH`) go through `apiFetch` directly in the form components —
 * the same split F17-03/F17-04 used for categories and warehouses.
 *
 * Variants are only reachable per product (`GET /products/:id/variants`) — there is no tenant-wide
 * variant list endpoint (`GAP-VARIANT-LIST`), so no `listVariants()` helper exists here.
 */
export interface ListProductsQuery {
  page?: number;
  pageSize?: number;
  status?: 'draft' | 'active' | 'discontinued';
  categoryId?: string;
}

export async function listProducts(query: ListProductsQuery = {}): Promise<Paginated<Product>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.categoryId) {
    params['categoryId'] = query.categoryId;
  }
  return serverApiFetch<Paginated<Product>>('/api/v1/products', { query: params });
}

export async function getProduct(id: string): Promise<Product> {
  return serverApiFetch<Product>(`/api/v1/products/${id}`);
}

/** `GET /products/:id/variants` — a plain array, not paginated (a product has few variants). */
export async function listProductVariants(productId: string): Promise<Variant[]> {
  return serverApiFetch<Variant[]>(`/api/v1/products/${productId}/variants`);
}

export async function getProductVariant(productId: string, variantId: string): Promise<Variant> {
  return serverApiFetch<Variant>(`/api/v1/products/${productId}/variants/${variantId}`);
}
