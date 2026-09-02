/**
 * The list of selectable timezones — **the exact same set the backend validates against**
 * (`update-tenant-settings.dto.ts`: `@IsIn(Intl.supportedValuesOf('timeZone'))`). Both sides read
 * it from the same runtime API, so a value the picker offers is always a value the server accepts;
 * there is no hand-maintained catalogue to drift.
 *
 * `Intl.supportedValuesOf` is supported in every browser this app targets and in Node ≥ 18. The
 * guarded fallback keeps a broken environment from taking the settings page down — it just offers
 * a short, safe list plus whatever the tenant already has saved.
 */
export function listSupportedTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    if (Array.isArray(zones) && zones.length > 0) {
      return zones;
    }
  } catch {
    /* fall through */
  }
  return ['UTC', 'America/Bogota', 'America/Guayaquil', 'America/Lima', 'America/Mexico_City', 'America/New_York'];
}

/** Whether `value` is one the server would accept — used to decide if a saved timezone that is
 * somehow not in the current list still needs to appear as an option. */
export function isSupportedTimezone(value: string): boolean {
  return listSupportedTimezones().includes(value);
}
