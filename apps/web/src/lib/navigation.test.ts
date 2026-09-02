import { describe, expect, it } from 'vitest';
import { createPermissionChecker } from './auth/permissions';
import { filterNavigation, isNavItemActive, NAVIGATION, type NavItem } from './navigation';

describe('filterNavigation', () => {
  it('drops items whose permission the user lacks and keeps unguarded ones', () => {
    const withUsers = filterNavigation(NAVIGATION, createPermissionChecker(['core.users.read']));
    const withoutUsers = filterNavigation(NAVIGATION, createPermissionChecker([]));

    const labels = (sections: typeof NAVIGATION) =>
      sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels(withUsers)).toEqual(
      expect.arrayContaining(['Dashboard', 'Users', 'Company settings']),
    );
    expect(labels(withoutUsers)).toEqual(['Dashboard', 'Company settings']);
  });

  it('shows the Catalog items only with the right permissions', () => {
    const labels = (perms: string[]) =>
      filterNavigation(NAVIGATION, createPermissionChecker(perms)).flatMap((s) =>
        s.items.map((i) => i.label),
      );
    // no catalog permissions → no Categories / Attributes, and the empty "Catalog" section is dropped
    expect(labels([])).not.toContain('Categories');
    expect(labels([])).not.toContain('Attributes');
    expect(labels(['categories.view'])).toContain('Categories');
    expect(labels(['categories.view'])).not.toContain('Attributes');
    expect(labels(['categories.view'])).not.toContain('Products');
    // Products and Attributes ride on products.view
    expect(labels(['products.view'])).toContain('Attributes');
    expect(labels(['products.view'])).toContain('Products');
    expect(labels([])).not.toContain('Products');
  });

  it('shows the Inventory items only with the matching permissions', () => {
    const labels = (perms: string[]) =>
      filterNavigation(NAVIGATION, createPermissionChecker(perms)).flatMap((s) =>
        s.items.map((i) => i.label),
      );
    expect(labels([])).not.toContain('Warehouses');
    expect(labels([])).not.toContain('Locations');
    expect(labels(['warehouses.view'])).toContain('Warehouses');
    expect(labels(['warehouses.view'])).not.toContain('Locations');
    expect(labels(['locations.view'])).toContain('Locations');
    // the whole "Inventory" section is dropped when the user holds neither
    expect(
      filterNavigation(NAVIGATION, createPermissionChecker([])).map((s) => s.title),
    ).not.toContain('Inventory');
  });

  it('drops a section that becomes empty', () => {
    const sections = [
      {
        title: 'Admin',
        items: [
          { label: 'X', href: '/x', icon: 'settings', permission: 'core.roles.assign' } as NavItem,
        ],
      },
    ];
    expect(filterNavigation(sections, createPermissionChecker([]))).toEqual([]);
  });
});

describe('isNavItemActive', () => {
  const dashboard: NavItem = { label: 'Dashboard', href: '/', icon: 'home' };
  const users: NavItem = { label: 'Users', href: '/users', icon: 'users', activePaths: ['/users'] };

  it('matches "/" only exactly', () => {
    expect(isNavItemActive(dashboard, '/')).toBe(true);
    expect(isNavItemActive(dashboard, '/users')).toBe(false);
  });

  it('matches nested routes for a non-root item, respecting path boundaries', () => {
    expect(isNavItemActive(users, '/users')).toBe(true);
    expect(isNavItemActive(users, '/users/123')).toBe(true);
    expect(isNavItemActive(users, '/users/new')).toBe(true);
    expect(isNavItemActive(users, '/users-archive')).toBe(false);
    expect(isNavItemActive(users, '/settings')).toBe(false);
  });
});
