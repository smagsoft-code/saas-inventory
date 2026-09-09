import { ReportDateRangeQueryDto } from '../../../common/reporting/report-date-range.dto';

/**
 * `GET /platform/summary` (F18-10 — "Super-Admin Platform Metrics"). Extends the F18-01
 * `ReportDateRangeQueryDto` for the shared `from`/`to` field names + ISO-8601 format only.
 *
 * `from`/`to` are **both optional but must be supplied together** (enforced in
 * `PlatformSummaryService`: 400 when exactly one is present, or when `from >= to`). When both are
 * given they bound `metrics.md` `PLAT-TENANT-CREATED` / `kpis.md` `KPI-PLAT-TENANTS-NEW`
 * ("`count(tenants where created_at in range)`" — the metric's verbatim formula) as a half-open
 * `[from, to)` window on `tenants.created_at`.
 *
 * **No timezone, no `date_trunc`, no `groupBy`.** A platform metric spans every tenant, so there is
 * no single tenant timezone to bucket by (F18-01's timezone semantics are tenant-scoped); the
 * period metric is a single raw count over a `[from, to)` comparison on the `timestamptz`
 * `created_at`, with `from`/`to` supplied as UTC instants by the caller (F18-01 convention). No
 * `groupBy` — the only dimension any platform metric doc names is `status`, which is a fixed field
 * of the response, not a query parameter.
 *
 * The count / by-status / demo figures need no query parameter at all — they are always returned.
 */
export class PlatformSummaryQueryDto extends ReportDateRangeQueryDto {}
