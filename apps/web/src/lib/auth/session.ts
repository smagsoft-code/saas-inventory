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
 * Returns `null` for a genuine 401 (no/invalid session) **or** a 403 (no resolvable tenant
 * context) — both mean "nothing usable for this tenant route right now," never a transient error:
 *  - a real tenant user only ever 403s here when `tenants`/`identities`/`users` status turned them
 *    off mid-session (TenantGuard's live check) — a dead session, exactly like a 401.
 *  - a Platform Admin browsing under a Tenant Support session (ADR-0036 extension) 403s here the
 *    moment that session ends or expires while they're still on a tenant page — the same "session
 *    just isn't usable anymore" case, not a crash. Any other failure still propagates to the
 *    route's `error.tsx` — a transient API outage must not look like "logged out".
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
    if (isApiError(error) && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
});
