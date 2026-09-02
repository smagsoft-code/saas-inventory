import { describe, expect, it } from 'vitest';
import { isSupportedTimezone, listSupportedTimezones } from './timezones';

describe('timezones', () => {
  it('returns a non-empty list of IANA names', () => {
    const zones = listSupportedTimezones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain('America/Bogota');
  });

  it('matches the runtime set the backend validates against', () => {
    // update-tenant-settings.dto.ts uses exactly `Intl.supportedValuesOf('timeZone')`, so the
    // picker and the server accept the identical set (whatever the deployed runtime's ICU yields).
    expect(listSupportedTimezones()).toEqual(Intl.supportedValuesOf('timeZone'));
  });

  it('recognises a real IANA name and rejects a made-up one', () => {
    expect(isSupportedTimezone('America/Bogota')).toBe(true);
    expect(isSupportedTimezone('Mars/Olympus_Mons')).toBe(false);
  });
});
