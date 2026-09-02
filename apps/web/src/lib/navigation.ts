import type { PermissionCode } from './auth/permission-codes';
import type { PermissionChecker } from './auth/permissions';

/**
 * The single navigation registry (Prompt 016 §13 / §39). Every sidebar/menu link is declared
 * here — pages never hand-roll their own nav. Only routes that **actually exist today** appear;
 * FASE 17 modules are not listed as links until their routes are built (§13, §56).
 */
export interface NavItem {
  label: string;
  href: string;
  /** A short inline SVG-free glyph key resolved by the Sidebar to an icon. */
  icon: NavIcon;
  /** If set, the item is shown only when the user holds this permission. Absent → always shown
   * to any authenticated user. The backend still authorizes every resulting request (§15). */
  permission?: PermissionCode;
  /** Extra path prefixes that should still mark this item active (nested routes). `href` itself
   * is always included. */
  activePaths?: string[];
}

export type NavIcon =
  | 'home'
  | 'users'
  | 'settings'
  | 'categories'
  | 'attributes'
  | 'warehouse'
  | 'map-pin'
  | 'box';

export interface NavSection {
  /** `null` for the top-level group that needs no heading. */
  title: string | null;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    title: null,
    items: [{ label: 'Dashboard', href: '/', icon: 'home' }],
  },
  {
    title: 'Catalog',
    items: [
      {
        label: 'Products',
        href: '/products',
        icon: 'box',
        permission: 'products.view',
        activePaths: ['/products'],
      },
      {
        label: 'Categories',
        href: '/categories',
        icon: 'categories',
        permission: 'categories.view',
        activePaths: ['/categories'],
      },
      {
        label: 'Attributes',
        href: '/attributes',
        icon: 'attributes',
        // Reads ride on `products.view` (attributes.controller.ts), not a dedicated attributes-view code.
        permission: 'products.view',
        activePaths: ['/attributes'],
      },
    ],
  },
  {
    title: 'Inventory',
    items: [
      {
        label: 'Warehouses',
        href: '/warehouses',
        icon: 'warehouse',
        permission: 'warehouses.view',
        activePaths: ['/warehouses'],
      },
      {
        label: 'Locations',
        href: '/locations',
        icon: 'map-pin',
        permission: 'locations.view',
        activePaths: ['/locations'],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        label: 'Users',
        href: '/users',
        icon: 'users',
        permission: 'core.users.read',
        activePaths: ['/users'],
      },
      {
        label: 'Company settings',
        href: '/settings',
        icon: 'settings',
        activePaths: ['/settings'],
      },
    ],
  },
];

/** Drops items the user cannot see, then drops now-empty sections. Pure — unit tested. */
export function filterNavigation(sections: NavSection[], checker: PermissionChecker): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.permission || checker.can(item.permission)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Whether `item` should render as the active nav entry for the current pathname. `/` matches only
 * itself; every other item matches its `href` and any `activePaths` prefix, respecting path
 * boundaries so `/users` does not light up for a hypothetical `/users-archive`.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') {
    return pathname === '/';
  }
  const prefixes = [item.href, ...(item.activePaths ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
