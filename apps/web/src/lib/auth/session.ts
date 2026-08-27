import { cache } from 'react';
import { cookies } from 'next/headers';
import { apiFetch } from '../api/client';
import { isApiError } from '../api/errors';
import type { Session } from '../types/session';

/**
 * Server-side session lookup — `GET /auth/me` with the request's forwarded cookies. Wrapped in
 * React's `cache()` so the authenticated layout, a page, and any nested Server Component that
 * needs the user all share **one** `/auth/me` round-trip per request (Prompt 016 §16). UX/data
 * convenience only: the API re-checks auth on every call regardless (CLAUDE.md §7.6).
 *
 * Returns `null` only for a genuine 401 (no/invalid session). Any other failure propagates to the
 * route's `error.tsx` — a transient API outage must not look like "logged out".
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  if (!cookieHeader) {
    return null;
  }

  try {
    return await apiFetch<Session>('/api/v1/auth/me', { cookieHeader });
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      return null;
    }
    throw error;
  }
});
