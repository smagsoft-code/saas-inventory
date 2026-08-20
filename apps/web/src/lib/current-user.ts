import { cookies } from 'next/headers';
import { ApiError, apiFetch } from './api-client';

export interface CurrentUser {
  id: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  fullName: string;
  status: string;
  permissions: string[];
}

/**
 * Server-side session lookup — used by (tenant)/layout.tsx to decide whether to render the
 * authenticated shell or redirect to /login (frontend.md#authentication-and-route-protection).
 * This is a UX convenience, not the authorization boundary: the API re-checks on every request
 * regardless of what this returns.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  try {
    return await apiFetch<CurrentUser>('/api/v1/auth/me', { cookieHeader });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}
