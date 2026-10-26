import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, isSupportedTimezone, listSupportedTimezones } from './timezones';

describe('timezones', () => {
  it('returns a non-empty list of IANA names', () => {
    const zones = listSupportedTimezones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain('America/Bogota');
  });

  it('matches the set the backend validates against: the runtime names plus UTC', () => {
    // update-tenant-settings.dto.ts accepts every `Intl.supportedValuesOf('timeZone')` name plus `UTC`,
    // so the picker and the server accept the identical set (whatever the runtime's ICU yields).
    const runtime = Intl.supportedValuesOf('timeZone');
    const expected = runtime.includes('UTC') ? runtime : ['UTC', ...runtime];
    expect(listSupportedTimezones()).toEqual(expected);
  });

  it('always offers UTC — the platform default, which the runtime list omits (DEFECT-TZ-DEFAULT-UNSETTABLE)', () => {
    expect(DEFAULT_TIMEZONE).toBe('UTC');
    expect(listSupportedTimezones()).toContain('UTC');
    expect(isSupportedTimezone('UTC')).toBe(true);
    expect(listSupportedTimezones().filter((zone) => zone === 'UTC')).toHaveLength(1);
  });

  it('recognises a real IANA name and rejects a made-up one', () => {
    expect(isSupportedTimezone('America/Bogota')).toBe(true);
    expect(isSupportedTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isSupportedTimezone('utc ')).toBe(false);
  });
});
