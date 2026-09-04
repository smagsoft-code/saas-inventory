import { serverApiFetch } from '../api/server';
import type { SalesSummary, SalesSummaryGroupBy } from '../types/reports';

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
}

export async function getSalesSummary(query: SalesSummaryQuery): Promise<SalesSummary> {
  const params: Record<string, string> = { from: query.from, to: query.to, groupBy: query.groupBy };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<SalesSummary>('/api/v1/reports/sales-summary', { query: params });
}
