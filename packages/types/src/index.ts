/**
 * Cross-cutting, domain-agnostic type contracts shared between apps.
 * Business/domain types (products, inventory, tenants, ...) are added
 * once the corresponding modules are designed — not in this foundation phase.
 */

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiErrorShape {
  statusCode: number;
  message: string;
  code: string;
  correlationId?: string;
}

/**
 * Reporting foundations (F18-01 — see docs/architecture/reporting/filters-periods-and-scope.md).
 * The common response envelope every FASE 18 read-side reporting endpoint reuses. Existing FASE 17
 * operational list endpoints (e.g. `GET /orders`) are unaffected — they keep `PaginatedResult<T>`
 * above and their own pre-existing filter semantics.
 *
 * Period semantics are half-open `[from, to)`: `from` is an inclusive lower bound, `to` is an
 * exclusive upper bound — both ISO-8601 datetime strings, already resolved to UTC by the caller
 * (a calendar period like "this month" is interpreted in the tenant's timezone and converted to
 * this UTC range before the request is made; the endpoint itself does no timezone math).
 */
export interface ReportDateRangeParams {
  /** ISO-8601 datetime, inclusive lower bound. */
  from: string;
  /** ISO-8601 datetime, exclusive upper bound. */
  to: string;
}

/** One grouped row of a report. `key` is grouping-specific (an ISO date, a product id, ...); each
 * report's own response type extends this with its actual measures. */
export interface ReportBucket {
  key: string;
}

export interface ReportResult<TBucket extends ReportBucket = ReportBucket> {
  /** Echoes the resolved UTC request range — [from, to). */
  from: string;
  to: string;
  /** IANA timezone used to resolve calendar periods into the UTC range above (informational —
   * lets the caller render period labels correctly without re-deriving the conversion). */
  timezone: string;
  /** Present only when the report is grouped; a single-bucket "totals" report omits it. */
  groupBy?: string;
  buckets: TBucket[];
}
