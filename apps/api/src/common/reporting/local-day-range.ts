import { BadRequestException } from '@nestjs/common';
import type { HalfOpenRange } from './date-range';

/** `YYYY-MM-DD` calendar date (no time, no zone) — the business-day filter format. */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseCalendarDate(value: string, field: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new BadRequestException(`\`${field}\` is not a valid calendar date.`);
  }
  return { year, month, day };
}

/** Offset (wall clock minus UTC), ms, that `timeZone` has at instant `at`. */
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
  const wallClockAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((wallClockAsUtc - at.getTime()) / 60_000) * 60_000;
}

/** UTC instant of local midnight at the start of `year-month-day` in `timeZone` (two passes so a
 * DST change between the guess and the real instant is corrected). `day` may overflow (month end). */
function zonedMidnightToUtc(timeZone: string, year: number, month: number, day: number): Date {
  const wallClockGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = wallClockGuess - timeZoneOffsetMs(timeZone, new Date(wallClockGuess));
  utc = wallClockGuess - timeZoneOffsetMs(timeZone, new Date(utc));
  return new Date(utc);
}

/**
 * Business-day range: `dateFrom` and `dateTo` are calendar dates in the tenant's own IANA zone;
 * the result is the half-open UTC range `[start of dateFrom, start of the day after dateTo)`, so the
 * whole final day is included regardless of the zone. A missing `dateTo` means "the same day as
 * `dateFrom`". The upper bound is exclusive (`lt`), never `23:59:59.999`.
 */
export function localDayRangeToUtc(dateFrom: string, dateTo: string | undefined, timeZone: string): HalfOpenRange {
  const from = parseCalendarDate(dateFrom, 'dateFrom');
  const to = parseCalendarDate(dateTo ?? dateFrom, 'dateTo');
  if (Date.UTC(to.year, to.month - 1, to.day) < Date.UTC(from.year, from.month - 1, from.day)) {
    throw new BadRequestException('`dateTo` must not be before `dateFrom`.');
  }
  return {
    gte: zonedMidnightToUtc(timeZone, from.year, from.month, from.day),
    lt: zonedMidnightToUtc(timeZone, to.year, to.month, to.day + 1),
  };
}
