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
    // Stock on hand + Movements + Transfers ride on inventory.view
    expect(labels([])).not.toContain('Stock on hand');
    expect(labels([])).not.toContain('Transfers');
    expect(labels(['inventory.view'])).toEqual(
      expect.arrayContaining(['Stock on hand', 'Movements', 'Transfers']),
    );
    expect(labels(['inventory.view'])).not.toContain('Warehouses');
    // the transfer-request permission alone does not surface the Transfers nav item
    expect(labels(['inventory.transfers.request'])).not.toContain('Transfers');
    // the whole "Inventory" section is dropped when the user holds none of its permissions
    expect(
      filterNavigation(NAVIGATION, createPermissionChecker([])).map((s) => s.title),
    ).not.toContain('Inventory');
  });

  it('shows the Sales items only with the matching permissions', () => {
    const labels = (perms: string[]) =>
      filterNavigation(NAVIGATION, createPermissionChecker(perms)).flatMap((s) => s.items.map((i) => i.label));
    expect(labels([])).not.toContain('New sale');
    expect(labels([])).not.toContain('Customers');
    expect(labels(['sales.orders.create'])).toContain('New sale');
    expect(labels(['sales.orders.create'])).not.toContain('Customers');
    expect(labels(['sales.customers.view'])).toContain('Customers');
    expect(labels(['sales.customers.view'])).not.toContain('New sale');
    // Sales history rides on sales.orders.view
    expect(labels([])).not.toContain('Sales history');
    expect(labels(['sales.orders.view'])).toContain('Sales history');
    // the whole "Sales" section is dropped when the user holds none of its permissions
    expect(filterNavigation(NAVIGATION, createPermissionChecker([])).map((s) => s.title)).not.toContain('Sales');
  });

  it('shows Approvals for a holder of EITHER pricing-discount permission (anyPermission / OR gate)', () => {
    const labels = (perms: string[]) =>
      filterNavigation(NAVIGATION, createPermissionChecker(perms)).flatMap((s) => s.items.map((i) => i.label));
    expect(labels([])).not.toContain('Approvals');
    expect(labels(['sales.orders.view'])).not.toContain('Approvals');
    expect(labels(['pricing.discount.request'])).toContain('Approvals');
    expect(labels(['pricing.discount.approve'])).toContain('Approvals');
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

  it('lets a more specific sibling win a nested path', () => {
    const stock: NavItem = { label: 'Stock on hand', href: '/inventory', icon: 'layers', activePaths: ['/inventory'] };
    const movements: NavItem = { label: 'Movements', href: '/inventory/movements', icon: 'activity', activePaths: ['/inventory/movements'] };
    const transfers: NavItem = { label: 'Transfers', href: '/inventory/transfers', icon: 'transfer', activePaths: ['/inventory/transfers'] };
    const siblings = ['/inventory', '/inventory/movements', '/inventory/transfers'];

    expect(isNavItemActive(stock, '/inventory', siblings)).toBe(true);
    expect(isNavItemActive(stock, '/inventory/b1', siblings)).toBe(true);
    // on the movements path only Movements is active
    expect(isNavItemActive(stock, '/inventory/movements', siblings)).toBe(false);
    expect(isNavItemActive(movements, '/inventory/movements', siblings)).toBe(true);
    expect(isNavItemActive(movements, '/inventory/movements/x', siblings)).toBe(true);
    // nested transfer routes activate Transfers, never the parent Stock on hand
    expect(isNavItemActive(transfers, '/inventory/transfers', siblings)).toBe(true);
    expect(isNavItemActive(transfers, '/inventory/transfers/new', siblings)).toBe(true);
    expect(isNavItemActive(transfers, '/inventory/transfers/abc-123', siblings)).toBe(true);
    expect(isNavItemActive(stock, '/inventory/transfers/new', siblings)).toBe(false);
  });

  it('keeps Customers and New sale independent (nested customer routes, order detail)', () => {
    const newSale: NavItem = { label: 'New sale', href: '/sales/new', icon: 'cart', activePaths: ['/sales/new'] };
    const customers: NavItem = { label: 'Customers', href: '/customers', icon: 'contact', activePaths: ['/customers'] };
    const salesHistory: NavItem = { label: 'Sales history', href: '/sales', icon: 'receipt', activePaths: ['/sales'] };
    const siblings = ['/sales/new', '/sales', '/customers'];
    expect(isNavItemActive(customers, '/customers', siblings)).toBe(true);
    expect(isNavItemActive(customers, '/customers/new', siblings)).toBe(true);
    expect(isNavItemActive(customers, '/customers/abc-1', siblings)).toBe(true);
    // New sale wins its own path; Sales history does not light up there (more specific sibling)
    expect(isNavItemActive(newSale, '/sales/new', siblings)).toBe(true);
    expect(isNavItemActive(salesHistory, '/sales/new', siblings)).toBe(false);
    // the order detail (/sales/:id) belongs to Sales history, never New sale
    expect(isNavItemActive(salesHistory, '/sales', siblings)).toBe(true);
    expect(isNavItemActive(salesHistory, '/sales/order-9', siblings)).toBe(true);
    expect(isNavItemActive(newSale, '/sales/order-9', siblings)).toBe(false);
  });

  it('activates Approvals on its own nested routes', () => {
    const approvals: NavItem = { label: 'Approvals', href: '/approvals', icon: 'approval', activePaths: ['/approvals'] };
    expect(isNavItemActive(approvals, '/approvals')).toBe(true);
    expect(isNavItemActive(approvals, '/approvals/abc-1')).toBe(true);
    expect(isNavItemActive(approvals, '/sales')).toBe(false);
  });
});
