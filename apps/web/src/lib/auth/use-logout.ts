'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client';

/**
 * Logout (Prompt 016 §19): calls the real backend endpoint so the refresh token is actually
 * revoked and the session cookies are cleared server-side — `router.push('/login')` alone is not
 * a logout. `POST /auth/logout` is idempotent and always succeeds from the caller's view
 * (`auth.service.ts`), so there is no error branch; a network failure still proceeds to the login
 * redirect rather than trapping the user in the app.
 */
export function useLogout(): { logout: () => void; pending: boolean } {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const logout = useCallback(() => {
    setPending(true);
    void (async () => {
      try {
        await apiFetch('/api/v1/auth/logout', { method: 'POST' });
      } catch {
        // best-effort — see doc comment
      } finally {
        // `replace` (not `push`) so Back does not return to an authenticated page, then `refresh`
        // so any cached Server Component tree for the app area is re-evaluated as logged-out.
        router.replace('/login');
        router.refresh();
      }
    })();
  }, [router]);

  return { logout, pending };
}
