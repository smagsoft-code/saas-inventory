/**
 * The list of selectable timezones — **the exact same set the backend validates against**
 * (`update-tenant-settings.dto.ts`: every `Intl.supportedValuesOf('timeZone')` name **plus `UTC`**).
 *
 * `UTC` has to be added explicitly: it is the platform default timezone, but the runtime's
 * `Intl.supportedValuesOf('timeZone')` does NOT list it (verified on Node 24.19: 418 names, no `UTC`).
 * Without it a tenant that moved away from UTC could never select it again (DEFECT-TZ-DEFAULT-UNSETTABLE).
 * Both sides build the set from the same runtime API plus that one constant, so a value the picker
 * offers is always a value the server accepts; there is no hand-maintained catalogue to drift.
 *
 * `Intl.supportedValuesOf` is supported in every browser this app targets and in Node ≥ 18. The
 * guarded fallback keeps a broken environment from taking the settings page down — it just offers
 * a short, safe list plus whatever the tenant already has saved.
 */
export const DEFAULT_TIMEZONE = 'UTC';

export function listSupportedTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    if (Array.isArray(zones) && zones.length > 0) {
      return zones.includes(DEFAULT_TIMEZONE) ? zones : [DEFAULT_TIMEZONE, ...zones];
    }
  } catch {
    /* fall through */
  }
  return [DEFAULT_TIMEZONE, 'America/Bogota', 'America/Guayaquil', 'America/Lima', 'America/Mexico_City', 'America/New_York'];
}

/** Whether `value` is one the server would accept — used to decide if a saved timezone that is
 * somehow not in the current list still needs to appear as an option. */
export function isSupportedTimezone(value: string): boolean {
  return listSupportedTimezones().includes(value);
}
