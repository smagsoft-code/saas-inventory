/**
 * Date semantics of the sales-history filter bar (tabla + tarjetas share them).
 *
 * The user picks calendar days; they are sent to the API **as calendar days** (`YYYY-MM-DD`) and the
 * backend resolves them in the tenant's own timezone as the half-open range
 * `[start of Desde, start of the day after Hasta)`. The frontend never builds UTC instants for this
 * filter (that was the old bug: a UTC "day" is not the tenant's day).
 *
 * - Default: Desde = Hasta = today, in the tenant's timezone (never the browser's, never the server's).
 * - Hasta empty ⇒ the same day as Desde.
 * - Desde cannot be empty: an empty/invalid Desde falls back to today (explicit and documented in the UI).
 * - Hasta before Desde is ignored (treated as empty), never silently swapped.
 */

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string | undefined): value is string {
  if (!value || !CALENDAR_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Today's calendar date (`YYYY-MM-DD`) in `timeZone`; falls back to UTC for an unknown zone. */
export function tenantToday(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export interface HistoryDates {
  /** Always a valid calendar date. */
  dateFrom: string;
  /** Only set when it is a valid date on/after `dateFrom` and different from it. */
  dateTo: string | undefined;
}

export function resolveHistoryDates(
  raw: { dateFrom?: string | undefined; dateTo?: string | undefined },
  timeZone: string,
  now: Date = new Date(),
): HistoryDates {
  const dateFrom = isCalendarDate(raw.dateFrom) ? raw.dateFrom : tenantToday(timeZone, now);
  const dateTo = isCalendarDate(raw.dateTo) && raw.dateTo > dateFrom ? raw.dateTo : undefined;
  return { dateFrom, dateTo };
}
