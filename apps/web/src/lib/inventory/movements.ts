import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { InventoryMovement, MovementType } from '../types/inventory';

/**
 * Server-side reads for the inventory movement ledger (`GET /api/v1/inventory/movements`,
 * permission `inventory.view`).
 *
 * The backend contract offers `productVariantId`, `locationId`, `movementType`, and — since F18-03
 * (`GAP-MOVEMENTS-DATE-FILTER`, resolved) — `occurredFrom`/`occurredTo`, a half-open
 * `[occurredFrom, occurredTo)` filter on `occurred_at` (never `created_at`). **Still no sort** —
 * rows come back newest-first by the repository's own `created_at DESC`; nothing is re-ordered here.
 */
export interface ListMovementsQuery {
  page?: number;
  pageSize?: number;
  productVariantId?: string;
  locationId?: string;
  movementType?: MovementType;
  occurredFrom?: string;
  occurredTo?: string;
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
  if (query.occurredFrom) {
    params['occurredFrom'] = query.occurredFrom;
  }
  if (query.occurredTo) {
    params['occurredTo'] = query.occurredTo;
  }
  return serverApiFetch<Paginated<InventoryMovement>>('/api/v1/inventory/movements', { query: params });
}
