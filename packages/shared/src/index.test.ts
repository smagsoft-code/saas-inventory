import { describe, expect, it } from 'vitest';
import { generateId, isNonNullable, sleep, tenantStartOfDayUtc } from './index';

describe('shared package', () => {
  it('isNonNullable filters null and undefined', () => {
    expect([1, null, 2, undefined, 3].filter(isNonNullable)).toEqual([1, 2, 3]);
  });

  it('sleep resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });

  describe('generateId', () => {
    it('generates a valid UUIDv7 (version nibble 7, RFC 4122 variant)', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('generates unique, monotonically-sortable ids for calls close in time', () => {
      const ids = Array.from({ length: 50 }, () => generateId());
      expect(new Set(ids).size).toBe(ids.length);
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });
  });

  describe('tenantStartOfDayUtc (F18-01)', () => {
    it('returns the same UTC day boundary for a UTC tenant', () => {
      const now = new Date('2026-06-15T14:23:00.000Z');
      expect(tenantStartOfDayUtc('UTC', now)).toBe('2026-06-15T00:00:00.000Z');
    });

    it('shifts start-of-day back for a positive-offset zone (Asia/Kolkata, +05:30)', () => {
      const now = new Date('2026-06-15T02:00:00.000Z');
      expect(tenantStartOfDayUtc('Asia/Kolkata', now)).toBe('2026-06-14T18:30:00.000Z');
    });

    it('accounts for DST in a negative-offset zone (America/New_York)', () => {
      expect(tenantStartOfDayUtc('America/New_York', new Date('2026-06-15T02:00:00.000Z'))).toBe(
        '2026-06-14T04:00:00.000Z',
      );
      expect(tenantStartOfDayUtc('America/New_York', new Date('2026-01-15T02:00:00.000Z'))).toBe(
        '2026-01-14T05:00:00.000Z',
      );
    });

    it('falls back to UTC midnight for an unknown zone rather than throwing', () => {
      const now = new Date('2026-06-15T14:23:00.000Z');
      expect(tenantStartOfDayUtc('Not/AZone', now)).toBe('2026-06-15T00:00:00.000Z');
    });
  });
});
