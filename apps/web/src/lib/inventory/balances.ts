import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { InventoryBalance } from '../types/inventory';

/**
 * Server-side reads for inventory balances (`GET /api/v1/inventory/balances*`, permission
 * `inventory.view`). Adjustment writes go through `apiFetch` in the adjustment form.
 *
 * The backend contract offers only `productVariantId` and `locationId` filters — no warehouse,
 * product, status, search or sort. Nothing else is added here.
 */
export interface ListBalancesQuery {
  page?: number;
  pageSize?: number;
  productVariantId?: string;
  locationId?: string;
}

export async function listBalances(query: ListBalancesQuery = {}): Promise<Paginated<InventoryBalance>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.productVariantId) {
    params['productVariantId'] = query.productVariantId;
  }
  if (query.locationId) {
    params['locationId'] = query.locationId;
  }
  return serverApiFetch<Paginated<InventoryBalance>>('/api/v1/inventory/balances', { query: params });
}

export async function getBalance(id: string): Promise<InventoryBalance> {
  return serverApiFetch<InventoryBalance>(`/api/v1/inventory/balances/${id}`);
}
