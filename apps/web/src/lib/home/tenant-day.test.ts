import { describe, expect, it } from 'vitest';
import { tenantStartOfDayUtc } from './tenant-day';

describe('tenantStartOfDayUtc', () => {
  it('returns the same UTC day boundary for a UTC tenant', () => {
    const now = new Date('2026-06-15T14:23:00.000Z');
    expect(tenantStartOfDayUtc('UTC', now)).toBe('2026-06-15T00:00:00.000Z');
  });

  it('shifts start-of-day back for a positive-offset zone (Asia/Kolkata, +05:30)', () => {
    // 02:00Z is 07:30 on the 15th in Kolkata → local midnight of the 15th is 18:30Z on the 14th.
    const now = new Date('2026-06-15T02:00:00.000Z');
    expect(tenantStartOfDayUtc('Asia/Kolkata', now)).toBe('2026-06-14T18:30:00.000Z');
  });

  it('accounts for DST in a negative-offset zone (America/New_York)', () => {
    // Summer: EDT = UTC-4. 02:00Z on the 15th is 22:00 on the 14th local → local midnight = 04:00Z.
    expect(tenantStartOfDayUtc('America/New_York', new Date('2026-06-15T02:00:00.000Z'))).toBe(
      '2026-06-14T04:00:00.000Z',
    );
    // Winter: EST = UTC-5. 02:00Z on the 15th is 21:00 on the 14th local → local midnight = 05:00Z.
    expect(tenantStartOfDayUtc('America/New_York', new Date('2026-01-15T02:00:00.000Z'))).toBe(
      '2026-01-14T05:00:00.000Z',
    );
  });

  it('does not roll over the day when it is still late evening locally', () => {
    // 03:30Z on the 15th is 23:30 on the 14th in New York (EDT) — still the 14th.
    expect(tenantStartOfDayUtc('America/New_York', new Date('2026-06-15T03:30:00.000Z'))).toBe(
      '2026-06-14T04:00:00.000Z',
    );
  });

  it('falls back to UTC midnight for an unknown zone rather than throwing', () => {
    const now = new Date('2026-06-15T14:23:00.000Z');
    expect(tenantStartOfDayUtc('Not/AZone', now)).toBe('2026-06-15T00:00:00.000Z');
  });
});
