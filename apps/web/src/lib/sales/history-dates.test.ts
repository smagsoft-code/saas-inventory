import { describe, expect, it } from 'vitest';
import { isCalendarDate, resolveHistoryDates, tenantToday } from './history-dates';

describe('tenantToday', () => {
  it('uses the tenant timezone, not UTC (20:00 in Guayaquil on the 13th is already the 14th in UTC)', () => {
    const now = new Date('2026-10-14T01:00:00Z');
    expect(tenantToday('America/Guayaquil', now)).toBe('2026-10-13');
    expect(tenantToday('UTC', now)).toBe('2026-10-14');
  });

  it('is ahead of UTC for an east-of-UTC zone', () => {
    expect(tenantToday('Asia/Tokyo', new Date('2026-10-13T16:00:00Z'))).toBe('2026-10-14');
  });

  it('falls back to the UTC date for an unknown zone instead of throwing', () => {
    expect(tenantToday('Not/AZone', new Date('2026-10-13T10:00:00Z'))).toBe('2026-10-13');
  });
});

describe('isCalendarDate', () => {
  it('accepts real dates only', () => {
    expect(isCalendarDate('2026-10-13')).toBe(true);
    expect(isCalendarDate('2026-02-31')).toBe(false);
    expect(isCalendarDate('13/10/2026')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
  });
});

describe('resolveHistoryDates', () => {
  const now = new Date('2026-10-13T15:00:00Z');

  it('defaults to today (both ends) when nothing is given', () => {
    expect(resolveHistoryDates({}, 'America/Guayaquil', now)).toEqual({ dateFrom: '2026-10-13', dateTo: undefined });
  });

  it('Desde with empty Hasta is that single day', () => {
    expect(resolveHistoryDates({ dateFrom: '2026-10-05' }, 'UTC', now)).toEqual({ dateFrom: '2026-10-05', dateTo: undefined });
  });

  it('Desde = Hasta is that single day', () => {
    expect(resolveHistoryDates({ dateFrom: '2026-10-05', dateTo: '2026-10-05' }, 'UTC', now).dateTo).toBeUndefined();
  });

  it('a real range keeps both ends (month and year crossings)', () => {
    expect(resolveHistoryDates({ dateFrom: '2026-12-30', dateTo: '2027-01-02' }, 'UTC', now)).toEqual({
      dateFrom: '2026-12-30',
      dateTo: '2027-01-02',
    });
  });

  it('ignores a Hasta before Desde and an invalid Desde (falls back to today)', () => {
    expect(resolveHistoryDates({ dateFrom: '2026-10-05', dateTo: '2026-10-01' }, 'UTC', now).dateTo).toBeUndefined();
    expect(resolveHistoryDates({ dateFrom: 'garbage' }, 'UTC', now).dateFrom).toBe('2026-10-13');
  });
});
