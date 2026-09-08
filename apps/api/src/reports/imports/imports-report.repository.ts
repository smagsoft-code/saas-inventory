import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { importJobs } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ImportsBucketRow {
  key: string;
  jobCount: string;
  totalRows: string;
  validRows: string;
  invalidRows: string;
  warningRows: string;
  importedRows: string;
}

export type DateTruncUnit = 'day' | 'week' | 'month';

interface RangeParams {
  gte: Date;
  lt: Date;
  status?: string | undefined;
}

/**
 * `reports/imports` read-side (F18-09, mirrors `reports/approvals` F18-05 / `reports/movements`
 * F18-07 — see those repositories' headers for the shared reasoning). Never
 * `ImportJobsRepository` / `ImportJobRowsRepository` (the transactional read/write-path
 * repositories) — modules.md's "reporting is a separate read-side" rule.
 *
 * Every query reads `import_jobs` **alone** — no join. One row is one import job;
 * `total_rows`/`valid_rows`/`invalid_rows`/`warning_rows`/`imported_rows` are per-row frozen integer
 * columns maintained by the pipeline. Because nothing is joined, `COUNT(*)` and every `SUM(*_rows)`
 * is exact — there is no fan-out (a join to `import_job_rows` would multiply a job count by its row
 * count, the exact trap the sales / returns reports have to guard with `DISTINCT`).
 *
 * The driving row set is bounded by `tenant_id = ? AND completed_at >= ? AND completed_at < ?` —
 * `completed_at` is `metrics.md` `IMP-ROWS-PERIOD`'s named anchor and is set on every terminal
 * transition (`ImportJobService.runCommit`/`.cancel`/`.markFailedAndAudit`); a job still in a
 * non-terminal status has `completed_at IS NULL`, and `>=`/`<` on `NULL` is `NULL`, so those jobs
 * are excluded automatically (they have not completed in any period). The optional `status`
 * equality filter narrows further.
 *
 * No dedicated `(tenant_id, completed_at)` index exists — `import_jobs` carries only
 * `(tenant_id, status, created_at)` and the worker-only partial `(status, created_at)`. This
 * matches F18-05's already-accepted decision for `price_approvals` (no index added): `import_jobs`
 * is a naturally small table (one row per human-initiated import operation — dozens per month for
 * an active tenant, not a per-transaction event), so a sequential scan over the tenant's jobs is
 * trivial. `(tenant_id, completed_at)` is the additive index to add if a high-volume tenant ever
 * emerges — not speculatively here (CLAUDE.md §7.7).
 */
@Injectable()
export class ImportsReportRepository {
  private baseConditions(tenantId: string, range: RangeParams): SQL[] {
    const conditions: SQL[] = [
      eq(importJobs.tenantId, tenantId),
      gte(importJobs.completedAt, range.gte),
      lt(importJobs.completedAt, range.lt),
    ];
    if (range.status) {
      conditions.push(eq(importJobs.status, range.status));
    }
    return conditions;
  }

  private readonly rowSums = {
    jobCount: sql<string>`count(*)`,
    totalRows: sql<string>`coalesce(sum(${importJobs.totalRows}), 0)`,
    validRows: sql<string>`coalesce(sum(${importJobs.validRows}), 0)`,
    invalidRows: sql<string>`coalesce(sum(${importJobs.invalidRows}), 0)`,
    warningRows: sql<string>`coalesce(sum(${importJobs.warningRows}), 0)`,
    importedRows: sql<string>`coalesce(sum(${importJobs.importedRows}), 0)`,
  };

  async summaryByPeriod(
    tx: TenantTransaction,
    tenantId: string,
    range: RangeParams & { unit: DateTruncUnit; timezone: string },
  ): Promise<ImportsBucketRow[]> {
    // Same alias-then-reference trick as the other FASE 18 period repositories — Drizzle renders an
    // identical `sql` fragment differently in SELECT vs GROUP BY/ORDER BY, which Postgres rejects as
    // two expressions. Bucket boundary is computed in the tenant's own IANA zone, never UTC.
    const bucketKey = sql<string>`to_char(date_trunc(${range.unit}, ${importJobs.completedAt} AT TIME ZONE ${range.timezone}), 'YYYY-MM-DD')`.as(
      'bucket_key',
    );

    return tx
      .select({ key: bucketKey, ...this.rowSums })
      .from(importJobs)
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(sql`bucket_key`)
      .orderBy(sql`bucket_key`);
  }

  async summaryByStatus(tx: TenantTransaction, tenantId: string, range: RangeParams): Promise<ImportsBucketRow[]> {
    return tx
      .select({ key: sql<string>`${importJobs.status}`, ...this.rowSums })
      .from(importJobs)
      .where(and(...this.baseConditions(tenantId, range)))
      .groupBy(importJobs.status)
      .orderBy(importJobs.status);
  }

  /** `groupBy`-independent aggregate over every completed job in `[from, to)` (after the optional
   * `status` filter). `key` is set to the literal `'total'` by the service. */
  async totals(tx: TenantTransaction, tenantId: string, range: RangeParams): Promise<ImportsBucketRow> {
    const rows = await tx
      .select({ key: sql<string>`'total'`, ...this.rowSums })
      .from(importJobs)
      .where(and(...this.baseConditions(tenantId, range)));
    return rows[0] ?? { key: 'total', jobCount: '0', totalRows: '0', validRows: '0', invalidRows: '0', warningRows: '0', importedRows: '0' };
  }
}
