import { describe, expect, it } from 'vitest';
import { toHalfOpenRange } from './date-range';

describe('toHalfOpenRange', () => {
  const from = '2026-09-01T00:00:00.000Z';
  const to = '2026-09-02T00:00:00.000Z';

  it('parses from/to into gte/lt Date bounds', () => {
    const range = toHalfOpenRange(from, to);
    expect(range.gte.toISOString()).toBe(from);
    expect(range.lt.toISOString()).toBe(to);
  });

  it('[from, to): a row exactly at `to` is excluded (lt, never lte)', () => {
    const range = toHalfOpenRange(from, to);
    const rowAtTo = new Date(to);
    expect(rowAtTo.getTime() < range.lt.getTime()).toBe(false);
    expect(rowAtTo.getTime() >= range.lt.getTime()).toBe(true);
  });

  it('[from, to): a row exactly at `from` is included (gte)', () => {
    const range = toHalfOpenRange(from, to);
    const rowAtFrom = new Date(from);
    expect(rowAtFrom.getTime() >= range.gte.getTime()).toBe(true);
  });

  it('[from, to): a row one millisecond before `to` is included', () => {
    const range = toHalfOpenRange(from, to);
    const rowJustBeforeTo = new Date(range.lt.getTime() - 1);
    expect(rowJustBeforeTo.getTime() < range.lt.getTime()).toBe(true);
  });
});
