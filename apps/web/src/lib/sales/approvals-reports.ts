import { serverApiFetch } from '../api/server';
import type { ApprovalsSummary, ApprovalsSummaryGroupBy } from '../types/approvals-reports';

/**
 * `GET /api/v1/reports/approvals-summary` (F18-05, `pricing.discount.approve` — no `reports.*`
 * permission exists, F18-01's ratified decision). `from`/`to` are required by the endpoint; this
 * helper never invents a default — the caller (the `/approvals` page) resolves one from
 * `session.timezone` before calling, same as `getSalesSummary` / `getReturnsSummary`.
 */
export interface ApprovalsSummaryQuery {
  from: string;
  to: string;
  groupBy: ApprovalsSummaryGroupBy;
  status?: string;
}

export async function getApprovalsSummary(query: ApprovalsSummaryQuery): Promise<ApprovalsSummary> {
  const params: Record<string, string> = { from: query.from, to: query.to, groupBy: query.groupBy };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<ApprovalsSummary>('/api/v1/reports/approvals-summary', { query: params });
}
