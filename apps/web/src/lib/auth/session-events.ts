/**
 * A tiny browser-only pub/sub for "the session just ended and the refresh could not save it".
 *
 * The api client (`lib/api/client.ts`) is transport code with no view of routing, so instead of
 * calling `router.push` itself it emits this event; `components/shell/session-expiry-listener.tsx`
 * (mounted once inside the authenticated shell) is what actually redirects to `/login`. Keeping
 * the two decoupled means a background fetch failing does not race several components into
 * competing navigations — there is exactly one listener.
 *
 * `GAP-SA-PLATFORM-401` (closed): a platform-scoped 401 is a **structurally different** session
 * (ADR-0032 — distinct cookies, distinct refresh endpoint) from a tenant one, so it gets its own
 * event/listener pair rather than reusing `SESSION_EXPIRED_EVENT` — a platform admin must never be
 * redirected to the tenant `/login`, and vice versa.
 */

export const SESSION_EXPIRED_EVENT = 'saas:session-expired';
export const PLATFORM_SESSION_EXPIRED_EVENT = 'saas:platform-session-expired';

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

export function emitPlatformSessionExpired(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(PLATFORM_SESSION_EXPIRED_EVENT));
}

export function onPlatformSessionExpired(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener(PLATFORM_SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(PLATFORM_SESSION_EXPIRED_EVENT, handler);
}
