import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { Location } from '../types/inventory';

/**
 * Server-side reads for locations (`GET /api/v1/locations*`, permission `locations.view`).
 * Client-side mutations (`POST`/`PATCH`) go through `apiFetch` directly in the form component.
 *
 * These are the contracts F17-06/F17-07 (adjustments, transfers) and F17-08 (sale location) will
 * reuse for the location selector.
 */
export interface ListLocationsQuery {
  page?: number;
  pageSize?: number;
  warehouseId?: string;
  status?: 'active' | 'inactive';
}

export async function listLocations(query: ListLocationsQuery = {}): Promise<Paginated<Location>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.warehouseId) {
    params['warehouseId'] = query.warehouseId;
  }
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<Paginated<Location>>('/api/v1/locations', { query: params });
}

export async function getLocation(id: string): Promise<Location> {
  return serverApiFetch<Location>(`/api/v1/locations/${id}`);
}
