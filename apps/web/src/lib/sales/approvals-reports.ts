import { serverApiFetch } from '../api/server';
import type { ApprovalsSummary, ApprovalsSummaryGroupBy } from '../types/approvals-reports';

/**
 * `GET /api/v1/reports/approvals-summary` (F18-05, `pricing.discount.approve` — no `reports.*`
 * permission exists, F18-01's ratified decision). `from`/`to` are required by the endpoint; this
 * helper never invents a default — the caller (the `/approvals` page) resolves one from
 * `session.timezone` before calling, same as `getSalesSummary` / `getReturnsSummary`.
 */
export interface ApprovalsSummaryQuery {
  /** `[from, to)` UTC instants. Omit both when using the business-day `dateFrom`/`dateTo`. */
  from?: string;
  to?: string;
  /** Business-day filter (`YYYY-MM-DD`, tenant timezone, whole final day inclusive); replaces from/to. */
  dateFrom?: string;
  dateTo?: string;
  locationId?: string;
  groupBy: ApprovalsSummaryGroupBy;
  status?: string;
}

export async function getApprovalsSummary(query: ApprovalsSummaryQuery): Promise<ApprovalsSummary> {
  const params: Record<string, string> = { groupBy: query.groupBy };
  if (query.from) params['from'] = query.from;
  if (query.to) params['to'] = query.to;
  if (query.dateFrom) params['dateFrom'] = query.dateFrom;
  if (query.dateTo) params['dateTo'] = query.dateTo;
  if (query.locationId) params['locationId'] = query.locationId;
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<ApprovalsSummary>('/api/v1/reports/approvals-summary', { query: params });
}
