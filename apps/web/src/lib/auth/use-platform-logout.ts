'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client';

/**
 * Platform-admin logout (F17-01 §21) — the platform equivalent of `use-logout.ts`. Calls the real
 * `POST /platform/auth/logout` so the platform refresh token is revoked and the `platform_*`
 * cookies are cleared server-side. The api client attaches the `X-CSRF-Token` double-submit header
 * from the (non-httpOnly) `platform_csrf_token` cookie automatically — the route is `@Public` but
 * not `@SkipCsrf`, so the header is required.
 *
 * Idempotent from the caller's view: a network failure still proceeds to the platform login
 * redirect rather than trapping the admin in the shell.
 */
export function usePlatformLogout(): { logout: () => void; pending: boolean } {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const logout = useCallback(() => {
    setPending(true);
    void (async () => {
      try {
        await apiFetch('/api/v1/platform/auth/logout', { method: 'POST' });
      } catch {
        // best-effort — see doc comment
      } finally {
        router.replace('/platform/login');
        router.refresh();
      }
    })();
  }, [router]);

  return { logout, pending };
}
