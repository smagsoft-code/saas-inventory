import { cookies } from 'next/headers';
import { apiFetch, type ApiFetchOptions } from './api-client';

/** Forwards the current Server Component's request cookies to the API — the same pattern
 * current-user.ts already established for GET /auth/me, factored out so every tenant-admin page
 * (settings, users, roles) doesn't repeat the cookies()-forwarding boilerplate. UX convenience
 * only, per frontend.md — the API re-checks auth/permissions on every request regardless. */
export async function serverApiFetch<T>(path: string, options: Omit<ApiFetchOptions, 'cookieHeader'> = {}): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  return apiFetch<T>(path, { ...options, cookieHeader });
}
