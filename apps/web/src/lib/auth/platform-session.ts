import { cache } from 'react';
import { cookies } from 'next/headers';
import { apiFetch } from '../api/client';
import { isApiError } from '../api/errors';
import type { PlatformSession } from '../types/platform-session';

/**
 * Server-side platform-admin session lookup — `GET /platform/auth/me` with the request's
 * forwarded cookies. Wrapped in React's `cache()` so the `(superadmin)` layout and any nested
 * Server Component share **one** round-trip per request. UX/data convenience only: the API
 * re-checks the platform principal on every `@PlatformOnly()` request regardless.
 *
 * Returns `null` only for a genuine 401 (no/invalid platform session). Any other failure
 * propagates to the route's `error.tsx` — a transient API outage must not look like "logged out".
 *
 * Deliberately separate from `getSession()` (tenant): a platform admin has no tenant `/auth/me`,
 * and a tenant user is not a platform principal. The two contexts never share state.
 */
export const getPlatformSession = cache(async (): Promise<PlatformSession | null> => {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  // Presence gate — no platform access token means there is nothing to verify.
  if (!cookieStore.get('platform_access_token')) {
    return null;
  }

  try {
    return await apiFetch<PlatformSession>('/api/v1/platform/auth/me', { cookieHeader });
  } catch (error) {
    if (isApiError(error) && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
});
