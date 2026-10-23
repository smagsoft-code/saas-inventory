import { serverApiFetch } from '../api/server';
import type { SalesSummary, SalesSummaryExceptional, SalesSummaryGroupBy } from '../types/reports';

/**
 * `GET /api/v1/reports/sales-summary` (F18-02, `sales.orders.view` — no `reports.*` permission
 * exists, F18-01's ratified decision). `from`/`to` are required by the endpoint; this helper never
 * invents a default — the caller (the `/sales` page) resolves one from `session.timezone` before
 * calling.
 */
export interface SalesSummaryQuery {
  /** `[from, to)` UTC instants. Omit both when using the business-day `dateFrom`/`dateTo`. */
  from?: string;
  to?: string;
  /** Business-day filter (`YYYY-MM-DD`, tenant timezone, whole final day inclusive); replaces from/to. */
  dateFrom?: string;
  dateTo?: string;
  documentType?: string;
  customerId?: string;
  groupBy: SalesSummaryGroupBy;
  status?: string;
  /** F18-06 — filter by `order_items.is_exceptional_discount`. Omitted / `'all'` = no filter. */
  exceptional?: SalesSummaryExceptional;
  /** OUI-002/S-HOME redesign — `orders.location_id` equality filter (every order has exactly one).
   * Narrows the aggregate to one Almacén; does not add a location grouping (`GAP-ORDERS-LOCATION`
   * stays open for that half). */
  locationId?: string;
  /** Orders placed at any Almacén of this Sucursal (warehouse). */
  warehouseId?: string;
  /** Only this seller's orders — honoured by the backend only for `sales.orders.view_all` holders. */
  placedByUserId?: string;
  /** History-table column filters (substring search / roll-up status). */
  /** One search box: order number, customer or seller. */
  q?: string;
  orderNumber?: string;
  customerName?: string;
  sellerName?: string;
  total?: string;
  notificationStatus?: string;
}

export async function getSalesSummary(query: SalesSummaryQuery): Promise<SalesSummary> {
  const params: Record<string, string> = { groupBy: query.groupBy };
  if (query.from) params['from'] = query.from;
  if (query.to) params['to'] = query.to;
  if (query.dateFrom) params['dateFrom'] = query.dateFrom;
  if (query.dateTo) params['dateTo'] = query.dateTo;
  if (query.documentType) params['documentType'] = query.documentType;
  if (query.customerId) params['customerId'] = query.customerId;
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.exceptional && query.exceptional !== 'all') {
    params['exceptional'] = query.exceptional;
  }
  if (query.locationId) {
    params['locationId'] = query.locationId;
  }
  if (query.warehouseId) {
    params['warehouseId'] = query.warehouseId;
  }
  if (query.placedByUserId) {
    params['placedByUserId'] = query.placedByUserId;
  }
  for (const key of ['q', 'orderNumber', 'customerName', 'sellerName', 'total', 'notificationStatus'] as const) {
    const value = query[key];
    if (value) params[key] = value;
  }

  return serverApiFetch<SalesSummary>('/api/v1/reports/sales-summary', { query: params });
}
