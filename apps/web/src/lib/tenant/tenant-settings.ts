import { cache } from 'react';
import { serverApiFetch } from '../api/server';
import { isApiError } from '../api/errors';
import type { TenantSettings } from '../types/tenant-settings';

export { resolveTenantTimezone } from '../types/tenant-settings';

const TENANT_SETTINGS_PATH = '/api/v1/administration/tenant-settings';

/**
 * Server-side read of the tenant's effective configuration
 * (`GET /administration/tenant-settings`, permission `administration.settings.view`). Wrapped in
 * React's `cache()` so a page and its nested Server Components share **one** round-trip per
 * request.
 *
 * Returns `null` when the caller may not read it (403 — most operational roles do not hold
 * `administration.settings.view`) or has no session (401). A genuine outage propagates to
 * `error.tsx`. Callers that only need the timezone should use `resolveTenantTimezone`
 * (re-exported here), which falls back to the same default the backend applies (`'UTC'`).
 *
 * **F17-02 leaves this as the read contract for later phases (F17-12 Home date handling —
 * GAP-HOME-DATE-TZ).** It does not compute date ranges, "today", or "this month" — that is F17-12.
 */
export const getTenantSettings = cache(async (): Promise<TenantSettings | null> => {
  try {
    return await serverApiFetch<TenantSettings>(TENANT_SETTINGS_PATH);
  } catch (error) {
    if (isApiError(error) && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
});
