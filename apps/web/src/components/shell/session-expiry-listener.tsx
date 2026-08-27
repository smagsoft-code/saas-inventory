'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onSessionExpired } from '../../lib/auth/session-events';
import { safeReturnTo } from '../../lib/auth/return-to';

/**
 * Mounted once inside the authenticated shell. When the api client signals that a session ended
 * and a refresh could not restore it (`session-expired` event, Prompt 016 §8 / §30), this sends
 * the user to `/login` with a sanitised `returnTo` so they land back where they were after
 * signing in. One listener, so a burst of failed background requests cannot cause competing
 * navigations.
 */
export function SessionExpiryListener(): null {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    return onSessionExpired(() => {
      const returnTo = safeReturnTo(pathname);
      const query = returnTo === '/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
      router.replace(`/login${query}`);
    });
  }, [router, pathname]);

  return null;
}
