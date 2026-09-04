/**
 * Reporting foundations (F18-01 — ratifies `GAP-DATE-SEMANTICS`, see
 * docs/architecture/reporting/filters-periods-and-scope.md#period-boundaries). Every FASE 18
 * read-side reporting endpoint interprets its `from`/`to` query params as a **half-open**
 * `[from, to)` period: `from` is an inclusive lower bound, `to` is an exclusive upper bound.
 *
 * This is a deliberate, forward-looking convention for *new* reporting endpoints — it does not
 * change `GET /orders` (`apps/api/src/sales/repositories/orders.repository.ts`), which has used
 * inclusive-both-bounds (`gte`/`lte`) since FASE 12 and is already relied on by the F17-09 Sales
 * History screen (which compensates by sending an explicit `...T23:59:59.999Z` upper bound).
 * Retroactively changing that endpoint's semantics would be a breaking change to an already-shipped,
 * already-tested F17 screen — out of scope for a foundations-only phase. New endpoints built on top
 * of this helper use `gte`/`lt`, never `lte`, for their upper bound.
 */

export interface HalfOpenRange {
  /** Inclusive lower bound. */
  gte: Date;
  /** Exclusive upper bound. */
  lt: Date;
}

/**
 * Turns a validated `[from, to)` pair of ISO-8601 datetime strings into `Date` bounds ready for a
 * repository query — always `gte`/`lt`, so the exclusive-upper-bound decision above lives in
 * exactly one place rather than being re-decided (and potentially gotten wrong as `lte`) by every
 * report's own repository code.
 *
 * Callers validate `from`/`to` are present and well-formed (e.g. via `ReportDateRangeQueryDto`)
 * before calling this — it does not itself validate, so it never needs to throw an HTTP-shaped
 * error from inside a repository/service layer.
 */
export function toHalfOpenRange(from: string, to: string): HalfOpenRange {
  return { gte: new Date(from), lt: new Date(to) };
}
