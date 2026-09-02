import type { NavIcon } from './navigation';

/**
 * The platform-admin navigation registry — the equivalent of `navigation.ts` for the
 * `(superadmin)` context, kept as its own source so the two navigations can never leak into each
 * other (F17-01 §11 / §14, [f17-navigation.md](../../../docs/architecture/frontend/f17-navigation.md)).
 *
 * F17-01 ships only the platform Home entry. Company management (`/platform/tenants`, the
 * `S-SA-TENANTS` screen) is **F17-13** and its nav entry is added by that sub-prompt when the
 * route exists — no placeholder link to an unbuilt page (F17-01 §12).
 */
export interface PlatformNavItem {
  label: string;
  href: string;
  icon: NavIcon;
  activePaths?: string[];
}

export const PLATFORM_NAVIGATION: PlatformNavItem[] = [
  { label: 'Home', href: '/platform', icon: 'home' },
];

/** `/platform` matches only itself; every other item matches its `href` and any `activePaths`
 * prefix, respecting path boundaries. Mirrors `isNavItemActive` in `navigation.ts`. */
export function isPlatformNavItemActive(item: PlatformNavItem, pathname: string): boolean {
  if (item.href === '/platform') {
    return pathname === '/platform';
  }
  const prefixes = [item.href, ...(item.activePaths ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
