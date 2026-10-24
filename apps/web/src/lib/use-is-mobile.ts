'use client';

import { useSyncExternalStore } from 'react';

/** Below Tailwind's `md` breakpoint — the same line the page layouts switch at. */
const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * Whether the viewport is phone-sized. For components that swap a TABLE for a list of cards: rendering
 * both and hiding one with CSS would put every value (and every accessible name) in the DOM twice, so
 * exactly one of them is rendered. Server snapshot / no `matchMedia` (tests, old browsers) = desktop,
 * the layout the table always had. Only use it in client components that render after data has loaded
 * — a first paint on the server is always the desktop one.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
