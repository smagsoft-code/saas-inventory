import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { localDayRangeToUtc } from './local-day-range';

describe('localDayRangeToUtc', () => {
  it('a single date (no dateTo) is exactly one local day, exclusive upper bound', () => {
    const r = localDayRangeToUtc('2026-10-13', undefined, 'America/Guayaquil');
    expect(r.gte.toISOString()).toBe('2026-10-13T05:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-10-14T05:00:00.000Z');
  });

  it('same from/to behaves like a single date', () => {
    expect(localDayRangeToUtc('2026-10-13', '2026-10-13', 'UTC')).toEqual(localDayRangeToUtc('2026-10-13', undefined, 'UTC'));
  });

  it('a 20:00-local sale on the 13th (01:00Z on the 14th) falls inside the 13th for UTC-5, not for UTC', () => {
    const sale = new Date('2026-10-14T01:00:00Z');
    const local = localDayRangeToUtc('2026-10-13', undefined, 'America/Guayaquil');
    const utc = localDayRangeToUtc('2026-10-13', undefined, 'UTC');
    expect(sale >= local.gte && sale < local.lt).toBe(true);
    expect(sale >= utc.gte && sale < utc.lt).toBe(false);
  });

  it('handles east-of-UTC zones (local midnight is the previous UTC day)', () => {
    const r = localDayRangeToUtc('2026-10-13', undefined, 'Asia/Tokyo');
    expect(r.gte.toISOString()).toBe('2026-10-12T15:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-10-13T15:00:00.000Z');
  });

  it('crosses month and year boundaries', () => {
    expect(localDayRangeToUtc('2026-10-31', '2026-11-02', 'UTC').lt.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(localDayRangeToUtc('2026-12-31', '2026-12-31', 'UTC').lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(localDayRangeToUtc('2026-12-30', '2027-01-01', 'UTC').lt.toISOString()).toBe('2027-01-02T00:00:00.000Z');
  });

  it('applies DST (America/New_York spring-forward day is 23h)', () => {
    const r = localDayRangeToUtc('2026-03-08', undefined, 'America/New_York');
    expect(r.gte.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('rejects an inverted range and an impossible date', () => {
    expect(() => localDayRangeToUtc('2026-10-14', '2026-10-13', 'UTC')).toThrow(BadRequestException);
    expect(() => localDayRangeToUtc('2026-02-31', undefined, 'UTC')).toThrow(BadRequestException);
  });
});
