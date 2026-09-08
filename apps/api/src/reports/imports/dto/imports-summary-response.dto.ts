import { ApiProperty } from '@nestjs/swagger';

/**
 * Bucket / totals shape for `GET /reports/imports-summary` (F18-09). `import_jobs` is queried
 * **standalone** — one row is exactly one import job, and `total_rows` / `valid_rows` /
 * `invalid_rows` / `warning_rows` / `imported_rows` are per-row frozen integer columns maintained by
 * the pipeline (`ImportValidationService` sets the first four on transition to `ready`;
 * `ImportExecutionService` sets `imported_rows` on commit). **No joins** — so `COUNT(*)` and every
 * `SUM(*_rows)` is exact with zero fan-out risk (never `import_job_rows`, whose grain would multiply
 * a job count by its row count).
 *
 * Every field is safe to sum across every bucket of the response — `jobCount` because one job lands
 * in exactly one bucket (its `completed_at`, or its `status`); the row sums because they are frozen
 * per job. The row columns are `NULL` for a job that never reached validation (`total_rows` etc.)
 * or never committed (`imported_rows`); `COALESCE(…, 0)` in the query means a bucket reports `0`
 * for such contributions, never `null`.
 *
 * Identical shape for a period bucket (`key` = tenant-local `YYYY-MM-DD`) and a status bucket
 * (`key` = an `import_jobs.status` value) — the two differ only in what `key` means, so one class
 * covers both (unlike `approvals-summary`, whose period and status buckets carry different fields).
 */
export class ImportsSummaryBucketDto {
  @ApiProperty({
    type: String,
    description:
      'For groupBy=day|week|month: the tenant-local calendar date (YYYY-MM-DD) the period starts on. ' +
      'For groupBy=status: an import_jobs.status value (only terminal statuses appear — see the class comment).',
  })
  key!: string;

  @ApiProperty({ type: Number, description: 'COUNT(*) of import jobs in this bucket (jobs with a non-NULL completed_at in [from,to)).' })
  jobCount!: number;

  @ApiProperty({ type: Number, description: 'Σ import_jobs.total_rows (rows in the uploaded file, after the header).' })
  totalRows!: number;

  @ApiProperty({ type: Number, description: 'Σ import_jobs.valid_rows (rows that passed validation with no error).' })
  validRows!: number;

  @ApiProperty({ type: Number, description: 'Σ import_jobs.invalid_rows (rows rejected by validation).' })
  invalidRows!: number;

  @ApiProperty({ type: Number, description: 'Σ import_jobs.warning_rows (rows accepted with a warning).' })
  warningRows!: number;

  @ApiProperty({ type: Number, description: 'Σ import_jobs.imported_rows (rows actually committed to catalog/inventory) — metrics.md IMP-ROWS-PERIOD.' })
  importedRows!: number;
}

/**
 * The `ReportResult<T>` shape (F18-01). **No `currency`** — an import job carries no monetary value
 * (unlike sales / returns / approvals summaries), the same posture as `movements-summary`. `status`
 * (the applied filter) is not echoed — only `from`/`to`/`timezone`/`groupBy` describe "what was
 * queried", matching every other FASE 18 report.
 *
 * `totals` is the same `ImportsSummaryBucketDto` shape aggregated over the whole `[from, to)`
 * completed-job window, independent of `groupBy` — `key` is the literal string `'total'`.
 */
export class ImportsSummaryResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: string;

  @ApiProperty({ type: String, example: 'America/Bogota', description: "The tenant's IANA timezone, used to resolve day/week/month bucket boundaries." })
  timezone!: string;

  @ApiProperty({ enum: ['day', 'week', 'month', 'status'] })
  groupBy!: 'day' | 'week' | 'month' | 'status';

  @ApiProperty({ type: ImportsSummaryBucketDto, description: "Aggregate over every completed job in [from,to); key is 'total'." })
  totals!: ImportsSummaryBucketDto;

  @ApiProperty({ type: [ImportsSummaryBucketDto] })
  buckets!: ImportsSummaryBucketDto[];
}
