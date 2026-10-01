/**
 * F18-09 ("Imports analytics") — mirrors `GET /api/v1/reports/imports-summary`'s real response
 * shape (`apps/api/src/reports/imports/dto/imports-summary-response.dto.ts`), the same "no field is
 * added that the endpoint does not send" convention as `lib/types/reports.ts` (F18-02) /
 * `lib/types/approvals-reports.ts` (F18-05) — `apps/web` does not import backend DTOs at runtime.
 *
 * Aggregates `import_jobs` **alone** (never `import_job_rows`), so a job that imported N rows is
 * **one** job (`jobCount`) carrying N in `totalRows`/`importedRows`. Half-open `[from, to)` on
 * `import_jobs.completed_at` — the anchor `metrics.md` `IMP-ROWS-PERIOD` names; jobs still running
 * (`completed_at` NULL) are not in any bucket. No monetary field (an import has no value).
 * `groupBy=status` buckets are necessarily the terminal statuses only
 * (`completed`/`completed_with_errors`/`failed`/`cancelled`) — the import outcome mix.
 */

export const IMPORTS_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'status'] as const;
export type ImportsSummaryGroupBy = (typeof IMPORTS_SUMMARY_GROUP_BY)[number];

export const IMPORTS_SUMMARY_GROUP_BY_LABELS: Record<ImportsSummaryGroupBy, string> = {
  day: 'Día',
  week: 'Semana',
  month: 'Mes',
  status: 'Estado',
};

/** Identical shape for a period bucket (`key` = tenant-local `YYYY-MM-DD`), a status bucket
 * (`key` = an import job status), and `totals` (`key` = `'total'`). Every field is safe to sum
 * across buckets. */
export interface ImportsSummaryBucket {
  key: string;
  jobCount: number;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningRows: number;
  importedRows: number;
}

export interface ImportsSummary {
  from: string;
  to: string;
  timezone: string;
  groupBy: ImportsSummaryGroupBy;
  totals: ImportsSummaryBucket;
  buckets: ImportsSummaryBucket[];
}
