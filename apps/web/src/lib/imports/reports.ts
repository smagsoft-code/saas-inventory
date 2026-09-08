import { serverApiFetch } from '../api/server';
import type { ImportsSummary, ImportsSummaryGroupBy } from '../types/imports-reports';

/**
 * `GET /api/v1/reports/imports-summary` (F18-09, `import.execute` — the only import-domain
 * permission, F18-01: no `reports.*` family). `from`/`to` are required by the endpoint (half-open
 * `[from, to)` on `import_jobs.completed_at`); the caller (the `/imports` page) resolves a sensible
 * default from `session.timezone` before calling, exactly like `getApprovalsSummary` /
 * `getMovementsSummary`. Tenant-wide (`import_jobs` has no location dimension).
 */
export interface ImportsSummaryQuery {
  from: string;
  to: string;
  groupBy: ImportsSummaryGroupBy;
  status?: string;
}

export async function getImportsSummary(query: ImportsSummaryQuery): Promise<ImportsSummary> {
  const params: Record<string, string> = { from: query.from, to: query.to, groupBy: query.groupBy };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<ImportsSummary>('/api/v1/reports/imports-summary', { query: params });
}
