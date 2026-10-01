import { serverApiFetch } from '../api/server';
import type {
  InventorySummary,
  InventorySummaryGroupBy,
  MovementsSummary,
  MovementsSummaryGroupBy,
  TransfersSummary,
  TransfersSummaryGroupBy,
} from '../types/inventory-reports';

/**
 * `GET /api/v1/reports/inventory-summary` (F18-03, `inventory.view` — no `reports.*` permission
 * exists, F18-01's ratified decision). Tenant-wide (matches `GET /inventory/balances`'s real,
 * current scope — never location-restricted; see the endpoint's own doc comment). No `from`/`to` —
 * this is a live snapshot, not a period query.
 */
export interface InventorySummaryQuery {
  warehouseId?: string;
  /** OUI-002/S-HOME redesign — `inventory_balances.location_id` equality filter, the finer-grained
   * Almacén sibling of `warehouseId` (Sucursal). */
  locationId?: string;
  categoryId?: string;
  groupBy?: InventorySummaryGroupBy;
}

export async function getInventorySummary(query: InventorySummaryQuery = {}): Promise<InventorySummary> {
  const params: Record<string, string> = {};
  if (query.warehouseId) {
    params['warehouseId'] = query.warehouseId;
  }
  if (query.locationId) {
    params['locationId'] = query.locationId;
  }
  if (query.categoryId) {
    params['categoryId'] = query.categoryId;
  }
  if (query.groupBy) {
    params['groupBy'] = query.groupBy;
  }
  return serverApiFetch<InventorySummary>('/api/v1/reports/inventory-summary', { query: params });
}

/**
 * `GET /api/v1/reports/movements-summary` (F18-07, `inventory.view`). `from`/`to` are required by
 * the endpoint (half-open `[from, to)` on `occurred_at`); the caller resolves a sensible default.
 * `movementType` / `locationId` / `productVariantId` are the optional filters `KPI-INV-MOVEMENTS`
 * names ("type, location, variant").
 */
export interface MovementsSummaryQuery {
  from: string;
  to: string;
  groupBy: MovementsSummaryGroupBy;
  movementType?: string;
  locationId?: string;
  productVariantId?: string;
}

export async function getMovementsSummary(query: MovementsSummaryQuery): Promise<MovementsSummary> {
  const params: Record<string, string> = { from: query.from, to: query.to, groupBy: query.groupBy };
  if (query.movementType) {
    params['movementType'] = query.movementType;
  }
  if (query.locationId) {
    params['locationId'] = query.locationId;
  }
  if (query.productVariantId) {
    params['productVariantId'] = query.productVariantId;
  }
  return serverApiFetch<MovementsSummary>('/api/v1/reports/movements-summary', { query: params });
}

/**
 * `GET /api/v1/reports/transfers-summary` (F18-08, `inventory.view`). Tenant-wide (matches
 * `GET /inventory/transfers`'s real scope). **No `from`/`to`** — a live snapshot of current
 * open-transfer state, not a period query. `groupBy` = `status` (default) | `destination` | `variant`.
 */
export async function getTransfersSummary(
  query: { groupBy?: TransfersSummaryGroupBy } = {},
): Promise<TransfersSummary> {
  const params: Record<string, string> = {};
  if (query.groupBy) {
    params['groupBy'] = query.groupBy;
  }
  return serverApiFetch<TransfersSummary>('/api/v1/reports/transfers-summary', { query: params });
}
