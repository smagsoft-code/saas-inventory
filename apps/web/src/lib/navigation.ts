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
  /** If set, the item is shown only when the user holds **at least one** of these permissions —
   * for a route whose backend gate is an OR (`@RequireAnyPermission`), e.g. the price-approval
   * queue readable by both the requester and the approver. Combined with `permission` by AND. */
  anyPermission?: readonly PermissionCode[];
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
  | 'box'
  | 'layers'
  | 'activity'
  | 'transfer'
  | 'cart'
  | 'contact'
  | 'receipt'
  | 'approval'
  | 'undo';

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
        label: 'Stock on hand',
        href: '/inventory',
        icon: 'layers',
        permission: 'inventory.view',
        // `/inventory/movements` and `/inventory/adjust` are their own nav item / in-page action.
        activePaths: ['/inventory'],
      },
      {
        label: 'Movements',
        href: '/inventory/movements',
        icon: 'activity',
        permission: 'inventory.view',
        activePaths: ['/inventory/movements'],
      },
      {
        label: 'Transfers',
        href: '/inventory/transfers',
        icon: 'transfer',
        permission: 'inventory.view',
        activePaths: ['/inventory/transfers'],
      },
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
    title: 'Sales',
    items: [
      {
        label: 'New sale',
        href: '/sales/new',
        icon: 'cart',
        permission: 'sales.orders.create',
        activePaths: ['/sales/new'],
      },
      {
        label: 'Sales history',
        href: '/sales',
        icon: 'receipt',
        permission: 'sales.orders.view',
        activePaths: ['/sales'],
      },
      {
        label: 'Customers',
        href: '/customers',
        icon: 'contact',
        permission: 'sales.customers.view',
        activePaths: ['/customers'],
      },
      {
        // `GET /price-approvals` requires request OR approve (`@RequireAnyPermission`) — mirror that.
        label: 'Approvals',
        href: '/approvals',
        icon: 'approval',
        anyPermission: ['pricing.discount.approve', 'pricing.discount.request'],
        activePaths: ['/approvals'],
      },
      {
        label: 'Returns',
        href: '/returns',
        icon: 'undo',
        permission: 'sales.returns.view',
        activePaths: ['/returns'],
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
      items: section.items.filter(
        (item) =>
          (!item.permission || checker.can(item.permission)) &&
          (!item.anyPermission || checker.canAny(item.anyPermission)),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

function matchesPrefix(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Whether `item` should render as the active nav entry for the current pathname. `/` matches only
 * itself; every other item matches its `href` and any `activePaths` prefix, respecting path
 * boundaries so `/users` does not light up for a hypothetical `/users-archive`.
 *
 * `siblingHrefs` (the hrefs of the other nav items) disambiguates nested items: on
 * `/inventory/movements` only "Movements" (`/inventory/movements`) lights up, not the parent
 * "Stock on hand" (`/inventory`), because a more specific sibling href also matches.
 */
export function isNavItemActive(item: NavItem, pathname: string, siblingHrefs: string[] = []): boolean {
  if (item.href === '/') {
    return pathname === '/';
  }
  const prefixes = [item.href, ...(item.activePaths ?? [])];
  if (!prefixes.some((prefix) => matchesPrefix(prefix, pathname))) {
    return false;
  }
  const longestOwn = Math.max(...prefixes.filter((p) => matchesPrefix(p, pathname)).map((p) => p.length));
  return !siblingHrefs.some(
    (href) => href !== item.href && href.length > longestOwn && matchesPrefix(href, pathname),
  );
}
