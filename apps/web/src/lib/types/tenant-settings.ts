/**
 * Mirrors `apps/api/src/administration/dto` — `TenantSettingsResponseDto` /
 * `UpdateTenantSettingsDto` / `BusinessHoursEntryDto`. Kept local to the frontend, the same
 * convention as `lib/types/core.ts` / `lib/types/session.ts`.
 *
 * Endpoints:
 *  - `GET  /api/v1/administration/tenant-settings`  — permission `administration.settings.view`
 *  - `PATCH /api/v1/administration/tenant-settings` — permission `administration.settings.manage`
 *
 * `timezone` is the tenant's operational timezone (`tenant_settings.timezone`). The server
 * validates it against `Intl.supportedValuesOf('timeZone')` — the frontend builds the picker from
 * the identical browser API so the two never drift (see `lib/tenant/timezones.ts`).
 */
export interface BusinessHoursEntry {
  /** 0 = Sunday … 6 = Saturday (matches `Date.prototype.getDay()`). */
  dayOfWeek: number;
  /** true = closed all day; `opensAt`/`closesAt` are ignored server-side. */
  isClosed?: boolean;
  /** 24h `"HH:mm"`. Required by the server unless `isClosed`. */
  opensAt?: string;
  /** 24h `"HH:mm"`. Required by the server unless `isClosed`. Must be after `opensAt`. */
  closesAt?: string;
}

export interface TenantSettings {
  timezone: string;
  businessHours: BusinessHoursEntry[];
  /** `null` when the tenant has never saved custom settings (running on system defaults). */
  updatedAt: string | null;
}

/** PATCH body — both fields optional; `businessHours` is a whole-array replace (max 7 entries). */
export interface TenantSettingsUpdate {
  timezone?: string;
  businessHours?: BusinessHoursEntry[];
}

/** The system defaults the backend applies when no row exists
 * (`tenant-settings.service.ts` — `DEFAULT_TIMEZONE` / `DEFAULT_BUSINESS_HOURS`). Mirrored so a
 * caller that cannot read the endpoint (lacks `administration.settings.view`) still has a
 * defined fallback. */
export const TENANT_SETTINGS_DEFAULTS: Readonly<TenantSettings> = Object.freeze({
  timezone: 'UTC',
  businessHours: [],
  updatedAt: null,
});

/** The tenant's operational timezone, or the backend default (`'UTC'`) when it cannot be read.
 * A stable, dependency-free helper for later phases (F17-12) — never throws, never invents a
 * value. */
export function resolveTenantTimezone(settings: TenantSettings | null): string {
  return settings?.timezone ?? TENANT_SETTINGS_DEFAULTS.timezone;
}
