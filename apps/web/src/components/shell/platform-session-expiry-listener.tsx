'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onPlatformSessionExpired } from '../../lib/auth/session-events';
import { safeReturnTo } from '../../lib/auth/return-to';

/**
 * Mounted once inside `PlatformShell`. Closes `GAP-SA-PLATFORM-401`: before this, a platform
 * 401 (e.g. an expired `platform_access_token` — 900s TTL, the same short-lived pattern as the
 * tenant token) went through `apiFetch`'s 401 handling with no platform-aware listener, so it
 * surfaced as a raw "session expired" alert inside whatever action panel triggered it (suspend/
 * activate, a support-session start/end, an invitation resend) rather than sending the admin back
 * to sign in. Mirrors `SessionExpiryListener` exactly, but for the platform event/route pair —
 * never mixed with the tenant one (ADR-0032: structurally separate sessions).
 */
export function PlatformSessionExpiryListener(): null {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    return onPlatformSessionExpired(() => {
      const returnTo = safeReturnTo(pathname, '/platform');
      const query = returnTo === '/platform' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
      router.replace(`/platform/login${query}`);
    });
  }, [router, pathname]);

  return null;
}
