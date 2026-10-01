import type { NavIcon } from './navigation';

/**
 * The platform-admin navigation registry — the equivalent of `navigation.ts` for the
 * `(superadmin)` context, kept as its own source so the two navigations can never leak into each
 * other (F17-01 §11 / §14, [f17-navigation.md](../../../docs/architecture/frontend/f17-navigation.md)).
 *
 * F17-01 shipped only the platform Home entry. **F17-13** adds "Companies" (`/platform/tenants`,
 * the `S-SA-TENANTS` screen) now that the route exists. There is deliberately nothing else: a
 * platform dashboard, platform-admin management and platform-initiated tenant creation are all
 * `GAP-SA-*` (future) — no placeholder link to an unbuilt page (F17-01 §12).
 */
export interface PlatformNavItem {
  label: string;
  href: string;
  icon: NavIcon;
  activePaths?: string[];
}

export const PLATFORM_NAVIGATION: PlatformNavItem[] = [
  { label: 'Inicio', href: '/platform', icon: 'home' },
  { label: 'Empresas', href: '/platform/tenants', icon: 'building', activePaths: ['/platform/tenants'] },
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
