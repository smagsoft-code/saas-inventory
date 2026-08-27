/**
 * A tiny browser-only pub/sub for "the session just ended and the refresh could not save it".
 *
 * The api client (`lib/api/client.ts`) is transport code with no view of routing, so instead of
 * calling `router.push` itself it emits this event; `components/shell/session-expiry-listener.tsx`
 * (mounted once inside the authenticated shell) is what actually redirects to `/login`. Keeping
 * the two decoupled means a background fetch failing does not race several components into
 * competing navigations — there is exactly one listener.
 */

export const SESSION_EXPIRED_EVENT = 'saas:session-expired';

export function emitSessionExpired(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export function onSessionExpired(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}
