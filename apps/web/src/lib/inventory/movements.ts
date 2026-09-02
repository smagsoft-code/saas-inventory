import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { InventoryMovement, MovementType } from '../types/inventory';

/**
 * Server-side reads for the inventory movement ledger (`GET /api/v1/inventory/movements`,
 * permission `inventory.view`).
 *
 * The backend contract offers only `productVariantId`, `locationId` and `movementType` filters —
 * **no date range and no sort** (`GAP-MOVEMENTS-DATE-FILTER`). Rows come back newest-first by the
 * repository's own `created_at DESC`; nothing is re-ordered here.
 */
export interface ListMovementsQuery {
  page?: number;
  pageSize?: number;
  productVariantId?: string;
  locationId?: string;
  movementType?: MovementType;
}

export async function listMovements(query: ListMovementsQuery = {}): Promise<Paginated<InventoryMovement>> {
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
  if (query.movementType) {
    params['movementType'] = query.movementType;
  }
  return serverApiFetch<Paginated<InventoryMovement>>('/api/v1/inventory/movements', { query: params });
}
