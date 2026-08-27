import { cookies } from 'next/headers';
import { apiFetch, type ApiFetchOptions } from './client';

/**
 * Forwards the current Server Component's request cookies to the API, so one place owns the
 * `cookies()` boilerplate every authenticated server render would otherwise repeat. UX/data-
 * fetching convenience only — the API re-checks auth and permissions on every request regardless
 * (CLAUDE.md §7.6).
 */
export async function serverApiFetch<T>(
  path: string,
  options: Omit<ApiFetchOptions, 'cookieHeader' | '_retried'> = {},
): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  return apiFetch<T>(path, { ...options, cookieHeader });
}
