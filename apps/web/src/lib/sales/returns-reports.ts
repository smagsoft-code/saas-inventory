import { serverApiFetch } from '../api/server';
import type { ReturnsSummary, ReturnsSummaryGroupBy } from '../types/returns-reports';

/**
 * `GET /api/v1/reports/returns-summary` (F18-04, `sales.returns.view` — no `reports.*` permission
 * exists, F18-01's ratified decision). `from`/`to` are required by the endpoint; this helper never
 * invents a default — the caller (the `/returns` page) resolves one from `session.timezone` before
 * calling, same as `getSalesSummary`.
 */
export interface ReturnsSummaryQuery {
  from: string;
  to: string;
  groupBy: ReturnsSummaryGroupBy;
  status?: string;
}

export async function getReturnsSummary(query: ReturnsSummaryQuery): Promise<ReturnsSummary> {
  const params: Record<string, string> = { from: query.from, to: query.to, groupBy: query.groupBy };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<ReturnsSummary>('/api/v1/reports/returns-summary', { query: params });
}
