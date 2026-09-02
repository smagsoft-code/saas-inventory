import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { Warehouse } from '../types/inventory';

/**
 * Server-side reads for warehouses (`GET /api/v1/warehouses*`, permission `warehouses.view`).
 * Client-side mutations (`POST`/`PATCH`) go through `apiFetch` directly in the form component —
 * the same split F17-02/F17-03 used for tenant settings and categories.
 *
 * These are the contracts F17-05/F17-06/F17-07 (products location defaults, balances, transfers)
 * will reuse for the warehouse selector.
 */
export interface ListWarehousesQuery {
  page?: number;
  pageSize?: number;
  status?: 'active' | 'inactive';
}

export async function listWarehouses(query: ListWarehousesQuery = {}): Promise<Paginated<Warehouse>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<Paginated<Warehouse>>('/api/v1/warehouses', { query: params });
}

export async function getWarehouse(id: string): Promise<Warehouse> {
  return serverApiFetch<Warehouse>(`/api/v1/warehouses/${id}`);
}
