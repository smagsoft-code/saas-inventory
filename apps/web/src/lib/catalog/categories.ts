import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { Category, CategoryAttribute } from '../types/catalog';

/**
 * Server-side reads for categories (`GET /api/v1/categories*`, permission `categories.view`).
 * Client-side mutations (`POST`/`PATCH`/`PUT`) go through `apiFetch` directly in the form
 * components — the same split F17-02 used for tenant settings.
 *
 * These are the contracts F17-05 (product form) will consume for the category selector and, via
 * {@link getCategoryAttributes}, the category-driven dynamic attribute set (ADR-0026).
 */
export interface ListCategoriesQuery {
  page?: number;
  pageSize?: number;
  status?: 'active' | 'inactive';
}

export async function listCategories(query: ListCategoriesQuery = {}): Promise<Paginated<Category>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<Paginated<Category>>('/api/v1/categories', { query: params });
}

/**
 * The next automatic category code (`CAT-001`, `CAT-002`, …) — a preview of
 * `GET /api/v1/categories/next-code`. The form pre-fills it; if left untouched it is not sent and the
 * server assigns the real next one atomically.
 */
export async function getNextCategoryCode(): Promise<string> {
  const response = await serverApiFetch<{ code: string }>('/api/v1/categories/next-code');
  return response.code;
}

export async function getCategory(id: string): Promise<Category> {
  return serverApiFetch<Category>(`/api/v1/categories/${id}`);
}

/** The attribute definitions assigned to a category, with the per-assignment `isRequired` /
 * `displayOrder` (`GET /categories/:id/attributes`). Ordered by `displayOrder` server-side. */
export async function getCategoryAttributes(id: string): Promise<CategoryAttribute[]> {
  return serverApiFetch<CategoryAttribute[]>(`/api/v1/categories/${id}/attributes`);
}
