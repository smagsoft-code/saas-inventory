import { serverApiFetch } from '../api/server';
import type { InventorySummary, InventorySummaryGroupBy } from '../types/inventory-reports';

/**
 * `GET /api/v1/reports/inventory-summary` (F18-03, `inventory.view` — no `reports.*` permission
 * exists, F18-01's ratified decision). Tenant-wide (matches `GET /inventory/balances`'s real,
 * current scope — never location-restricted; see the endpoint's own doc comment). No `from`/`to` —
 * this is a live snapshot, not a period query.
 */
export interface InventorySummaryQuery {
  warehouseId?: string;
  categoryId?: string;
  groupBy?: InventorySummaryGroupBy;
}

export async function getInventorySummary(query: InventorySummaryQuery = {}): Promise<InventorySummary> {
  const params: Record<string, string> = {};
  if (query.warehouseId) {
    params['warehouseId'] = query.warehouseId;
  }
  if (query.categoryId) {
    params['categoryId'] = query.categoryId;
  }
  if (query.groupBy) {
    params['groupBy'] = query.groupBy;
  }
  return serverApiFetch<InventorySummary>('/api/v1/reports/inventory-summary', { query: params });
}
