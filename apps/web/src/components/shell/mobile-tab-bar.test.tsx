import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createPermissionChecker } from '../../lib/auth/permissions';
import type { PermissionCode } from '../../lib/auth/permission-codes';
import { filterNavigation, NAVIGATION } from '../../lib/navigation';
import { buildMobileTabs, MobileTabBar, visibleTabs } from './mobile-tab-bar';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ALL: PermissionCode[] = [
  'products.view',
  'sales.orders.create',
  'inventory.view',
  'sales.orders.view',
  'sales.customers.view',
  'sales.returns.view',
  'core.users.read',
];
const sections = (perms: PermissionCode[]) => filterNavigation(NAVIGATION, createPermissionChecker(perms));

/** The labels of the tab links currently on screen, left to right (the ＋ included). */
const onScreen = (nav: HTMLElement): string[] => within(nav).getAllByRole('link').map((a) => a.getAttribute('aria-label') ?? '');

/** A horizontal swipe on the bar (mouse events — jsdom has no touch layout). */
function swipe(nav: HTMLElement, dx: number): void {
  fireEvent.mouseDown(nav, { clientX: 200 });
  fireEvent.mouseUp(nav, { clientX: 200 + dx });
}

describe('buildMobileTabs', () => {
  it('leads with Inicio · Productos · + (nueva venta) · Inventario · Ventas, then every other item', () => {
    const tabs = buildMobileTabs(sections(ALL));
    expect(tabs.slice(0, 5).map((t) => t.label)).toEqual(['Inicio', 'Productos', 'Nueva venta', 'Inventario', 'Ventas']);
    expect(tabs[2]!.plus).toBe(true);
    const rest = tabs.slice(5).map((t) => t.label);
    expect(rest).toContain('Clientes');
    expect(rest).toContain('Devoluciones');
    expect(rest).not.toContain('Historial de ventas'); // already the "Ventas" tab
  });

  it('a main tab the user has no permission for does not appear (never a dead tab)', () => {
    const tabs = buildMobileTabs(sections(['sales.orders.view']));
    expect(tabs.slice(0, 2).map((t) => t.label)).toEqual(['Inicio', 'Ventas']);
    expect(tabs.map((t) => t.label)).not.toContain('Productos');
    expect(tabs.map((t) => t.label)).not.toContain('Nueva venta');
  });
});

describe('visibleTabs', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e', 'f'].map((label) => ({ label, plus: false, item: { label, href: `/${label}`, icon: 'home' as const } }));

  it('shows 4 around the ＋ (5 without it), wrapping from the last tab back to the first', () => {
    expect(visibleTabs(tabs, 0, true).tabs.map((t) => t.label)).toEqual(['a', 'b', 'c', 'd']);
    expect(visibleTabs(tabs, 4, true).tabs.map((t) => t.label)).toEqual(['e', 'f', 'a', 'b']);
    expect(visibleTabs(tabs, 0, false).tabs.map((t) => t.label)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(visibleTabs(tabs, -1, true).tabs.map((t) => t.label)).toEqual(['f', 'a', 'b', 'c']);
  });

  it('does not rotate when everything already fits', () => {
    expect(visibleTabs(tabs.slice(0, 4), 3, true)).toMatchObject({ rotating: false, tabs: tabs.slice(0, 4) });
  });
});

describe('MobileTabBar', () => {
  it('shows Inicio · Productos · ＋ · Inventario · Ventas, fixed to the bottom and hidden from lg up', () => {
    pathname = '/inventory';
    render(<MobileTabBar sections={sections(ALL)} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(nav).toHaveClass('lg:hidden', 'fixed', 'bottom-0');
    expect(onScreen(nav)).toEqual(['Inicio', 'Productos', 'Nueva venta', 'Inventario', 'Ventas']);
    expect(within(nav).getByRole('link', { name: 'Inventario' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Nueva venta' })).toHaveAttribute('href', '/sales/new');
  });

  it('the ＋ overlaps the page: raised above the bar', () => {
    pathname = '/';
    render(<MobileTabBar sections={sections(ALL)} />);
    expect(screen.getByRole('link', { name: 'Nueva venta' })).toHaveClass('-translate-y-6');
  });

  it('swiping left rotates the other tabs one slot; the ＋ never moves', () => {
    pathname = '/';
    render(<MobileTabBar sections={sections(ALL)} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    swipe(nav, -60);
    const after = onScreen(nav);
    expect(after[2]).toBe('Nueva venta');
    expect(after.slice(0, 2)).toEqual(['Productos', 'Inventario']);
    expect(after[3]).toBe('Ventas');
    expect(after).not.toContain('Inicio');
  });

  it('swiping right goes back, and rotating all the way around brings Inicio back (endless loop)', () => {
    pathname = '/';
    render(<MobileTabBar sections={sections(ALL)} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    swipe(nav, -60);
    swipe(nav, 60);
    expect(onScreen(nav)).toEqual(['Inicio', 'Productos', 'Nueva venta', 'Inventario', 'Ventas']);
    // Swipe right from the start: the LAST tab comes in on the left (wraps backwards).
    swipe(nav, 60);
    const wrapped = onScreen(nav);
    expect(wrapped[0]).not.toBe('Inicio');
    expect(wrapped[1]).toBe('Inicio');
    // Enough left swipes to go around once lands exactly where it started.
    const total = buildMobileTabs(sections(ALL)).filter((t) => !t.plus).length;
    swipe(nav, 60 * -1); // undo the backwards step
    for (let i = 0; i < total; i += 1) swipe(nav, -60);
    expect(onScreen(nav)).toEqual(['Inicio', 'Productos', 'Nueva venta', 'Inventario', 'Ventas']);
  });

  it('a tiny drag is a tap, not a swipe', () => {
    pathname = '/';
    render(<MobileTabBar sections={sections(ALL)} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    swipe(nav, -5);
    expect(onScreen(nav)).toEqual(['Inicio', 'Productos', 'Nueva venta', 'Inventario', 'Ventas']);
  });

  it('a swipe does not also follow the link it ended on', () => {
    pathname = '/';
    render(<MobileTabBar sections={sections(ALL)} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const link = within(nav).getByRole('link', { name: 'Ventas' });
    fireEvent.mouseDown(link, { clientX: 300 });
    fireEvent.mouseUp(link, { clientX: 200 });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false); // default prevented → the navigation is cancelled
  });

  it('with few tabs everything is shown and nothing rotates', () => {
    pathname = '/';
    render(<MobileTabBar sections={sections(['sales.orders.view'])} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const before = onScreen(nav);
    swipe(nav, -80);
    expect(onScreen(nav)).toEqual(before);
  });

  it('without permission for nueva venta there is no ＋ and five tabs are shown', () => {
    pathname = '/';
    render(<MobileTabBar sections={sections(['products.view', 'inventory.view', 'sales.orders.view', 'sales.customers.view', 'sales.returns.view'])} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).queryByRole('link', { name: 'Nueva venta' })).not.toBeInTheDocument();
    expect(onScreen(nav)).toHaveLength(5);
  });

  it('/sales/new lights up Nueva venta, not Ventas', () => {
    pathname = '/sales/new';
    render(<MobileTabBar sections={sections(ALL)} />);
    expect(screen.getByRole('link', { name: 'Nueva venta' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Ventas' })).not.toHaveAttribute('aria-current');
  });
});
