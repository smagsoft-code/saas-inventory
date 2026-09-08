import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ReportDateRangeQueryDto } from '../../../common/reporting/report-date-range.dto';

export const IMPORTS_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'status'] as const;
export type ImportsSummaryGroupBy = (typeof IMPORTS_SUMMARY_GROUP_BY)[number];

/** The real `import_jobs.status` enum (`import_jobs_status_check`, migration 0008 /
 * `08-import.ts:93`). `ListImportJobsQueryDto`'s own `JOB_STATUSES` constant is not exported, so it
 * is redeclared identically here rather than reaching into that operational DTO's module — the same
 * convention `ApprovalsSummaryQueryDto` / `ReturnsSummaryQueryDto` / `MovementsSummaryQueryDto`
 * follow. */
export const IMPORTS_SUMMARY_STATUSES = [
  'uploaded',
  'mapping',
  'validating',
  'ready',
  'importing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
] as const;

/**
 * `GET /reports/imports-summary` (F18-09 — "Imports analytics"). Resolves the one import metric the
 * reporting catalogue marks as a FASE 18 aggregate:
 *
 * - `IMP-ROWS-PERIOD` (`metrics.md` §7, **B** — "`Σ imported_rows` over jobs completed in range …
 *   `import_jobs` has `completed_at`; no filter/sum") and `reports.md`'s "a cross-job 'rows imported
 *   this month' rollup is **B**".
 *
 * **Timestamp anchor: `import_jobs.completed_at`.** This is the exact field `IMP-ROWS-PERIOD` names
 * ("jobs *completed* in range"), and code evidence confirms it is set on **every** terminal
 * transition — `completed`/`completed_with_errors` (`ImportJobService.runCommit`), `cancelled`
 * (`.cancel`), `failed` (`.markFailedAndAudit`) — and is `NULL` only while a job is still
 * non-terminal (`uploaded`/`mapping`/`validating`/`ready`/`importing`). Jobs with `NULL`
 * `completed_at` are therefore **excluded** from every bucket — they have not completed in any
 * period yet. A point-in-time "how many jobs are running right now" count (`IMP-JOBS-PENDING` /
 * `KPI-OPS-IMPORTS-RUNNING`) is a live queue depth over exactly those non-terminal jobs and is
 * **not** what this period report answers — it stays `GAP-MULTI-STATUS` territory (an array-`status`
 * filter on the operational `GET /imports` list), the same way F18-05 left `APPR-AGE` (queue age)
 * out of `approvals-summary`.
 *
 * Extends the F18-01 `ReportDateRangeQueryDto` as-is — `from`/`to` stay `string | undefined` here
 * for the same `useDefineForClassFields` reason `ApprovalsSummaryQueryDto` documents; **this report
 * requires both**, enforced by `ImportsReportService` (400 when either is missing). Half-open
 * `[from, to)` on `completed_at`, bucket boundaries in the tenant's own IANA timezone (server-side).
 *
 * `groupBy`:
 * - `day`/`week`/`month` — period buckets keyed by `completed_at` (`IMP-ROWS-PERIOD`).
 * - `status` — one bucket per real `import_jobs.status` present among **completed** jobs in the
 *   range; since only terminal jobs carry a non-`NULL` `completed_at`, this is necessarily the
 *   **import outcome mix** (`completed` / `completed_with_errors` / `failed` / `cancelled`) — the
 *   direct analogue of `approvals-summary?groupBy=status`. Resolves the `KPI-OPS-IMPORTS-ATTENTION`
 *   family (sum the `failed` + `completed_with_errors` buckets) in one call.
 *
 * `status` (optional filter) reuses the real 9-value enum — no default (the outcome mix is the
 * point). An invalid `groupBy` / `status` is a 400 via `@IsIn`, never silently ignored.
 *
 * No `mappingTemplateId` / `createdBy` / `duplicateHandlingMode` filter and no `job` / `mapping` /
 * `user` groupBy — no `metrics.md` row, KPI, report or gap asks for any of them, so they are
 * deliberately left out rather than added because they are technically easy.
 *
 * **Scope is tenant-wide** — `import_jobs` has no location dimension; matches every other FASE 18
 * report and the operational `GET /imports` list.
 *
 * Permission: `import.execute`, reused as-is (F18-01 — no `reports.*` family; the exact permission
 * every `IMP-*` row in `metrics.md` and every `REP-IMP-*` in `reports.md` already names, and the
 * only import-domain permission — database.md's RBAC design: "una permission para todo el flujo").
 */
export class ImportsSummaryQueryDto extends ReportDateRangeQueryDto {
  @ApiPropertyOptional({ enum: IMPORTS_SUMMARY_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(IMPORTS_SUMMARY_GROUP_BY)
  groupBy: ImportsSummaryGroupBy = 'day';

  @ApiPropertyOptional({ enum: IMPORTS_SUMMARY_STATUSES })
  @IsOptional()
  @IsIn(IMPORTS_SUMMARY_STATUSES)
  status?: (typeof IMPORTS_SUMMARY_STATUSES)[number];
}
