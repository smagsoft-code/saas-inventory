import { serverApiFetch } from '../api/server';
import type { SalesSummary, SalesSummaryExceptional, SalesSummaryGroupBy } from '../types/reports';

/**
 * `GET /api/v1/reports/sales-summary` (F18-02, `sales.orders.view` — no `reports.*` permission
 * exists, F18-01's ratified decision). `from`/`to` are required by the endpoint; this helper never
 * invents a default — the caller (the `/sales` page) resolves one from `session.timezone` before
 * calling.
 */
export interface SalesSummaryQuery {
  from: string;
  to: string;
  groupBy: SalesSummaryGroupBy;
  status?: string;
  /** F18-06 — filter by `order_items.is_exceptional_discount`. Omitted / `'all'` = no filter. */
  exceptional?: SalesSummaryExceptional;
}

export async function getSalesSummary(query: SalesSummaryQuery): Promise<SalesSummary> {
  const params: Record<string, string> = { from: query.from, to: query.to, groupBy: query.groupBy };
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.exceptional && query.exceptional !== 'all') {
    params['exceptional'] = query.exceptional;
  }
  return serverApiFetch<SalesSummary>('/api/v1/reports/sales-summary', { query: params });
}
