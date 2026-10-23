/**
 * Tenant-timezone date math for the operational Home (F17-12, `GAP-HOME-DATE-TZ`).
 *
 * The only correct source for "today" on a tenant dashboard is `tenant_settings.timezone` — never
 * the server's clock, never the browser's (`GAP-HOME-DATE-TZ`). This helper turns that IANA zone
 * into the UTC instant of the tenant's local midnight, which is what `GET /orders?createdFrom=`
 * expects (an ISO-8601 `date-time`, compared with `>=` — half-open lower bound, so the
 * inclusive/exclusive ambiguity of `createdTo` never bites, `GAP-DATE-SEMANTICS`).
 *
 * Implementation uses only the platform `Intl` API — no dependency, no `new Date()` interpretation
 * of a business period. It never throws: an unknown/blank zone falls back to UTC midnight so the
 * caller can still render *something* (and the tile documents the fallback).
 */

/** Offset (wall-clock minus UTC), in ms, that `timeZone` was at the given instant. Always a whole
 * number of minutes. */
function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((wallClockAsUtc - at.getTime()) / 60_000) * 60_000;
}

/** The UTC `Date` for `year-month-day 00:00:00` as a wall-clock time in `timeZone`. Two passes so a
 * DST change between the guessed instant and the real one is corrected (the one genuinely ambiguous
 * hour per year is close enough for a "today" count). */
function zonedMidnightToUtc(timeZone: string, year: number, month: number, day: number): Date {
  const wallClockGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = wallClockGuess - timeZoneOffsetMs(timeZone, new Date(wallClockGuess));
  utc = wallClockGuess - timeZoneOffsetMs(timeZone, new Date(utc));
  return new Date(utc);
}

/**
 * ISO-8601 UTC instant of "start of today" in `timeZone` — pass straight to
 * `GET /orders?createdFrom=`. `now` is injectable for tests.
 */
export function tenantStartOfDayUtc(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return zonedMidnightToUtc(timeZone, get('year'), get('month'), get('day')).toISOString();
  } catch {
    // Unknown zone — fall back to UTC midnight rather than throw. The tile notes the degradation.
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
}

/** `{ year, month, day }` of "now" as a wall-clock date in `timeZone` (month 1-12). Falls back to
 * the UTC date for an unknown zone, same posture as `tenantStartOfDayUtc`. */
export function tenantDateParts(timeZone: string, now: Date = new Date()): { year: number; month: number; day: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
  } catch {
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }
}

/** ISO-8601 UTC instant of the first instant of the current tenant-local month. */
export function tenantStartOfMonthUtc(timeZone: string, now: Date = new Date()): string {
  const { year, month } = tenantDateParts(timeZone, now);
  try {
    return zonedMidnightToUtc(timeZone, year, month, 1).toISOString();
  } catch {
    return new Date(Date.UTC(year, month - 1, 1)).toISOString();
  }
}

/** ISO-8601 UTC instant of the first instant of the current tenant-local year. */
export function tenantStartOfYearUtc(timeZone: string, now: Date = new Date()): string {
  const { year } = tenantDateParts(timeZone, now);
  try {
    return zonedMidnightToUtc(timeZone, year, 1, 1).toISOString();
  } catch {
    return new Date(Date.UTC(year, 0, 1)).toISOString();
  }
}
