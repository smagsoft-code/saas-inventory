import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HomeDashboard } from '../../lib/home/dashboard';
import { HomeMobile } from './home-mobile';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./sales-trend-chart', () => ({ SalesTrendChart: () => <div data-testid="trend" /> }));

function dashboard(overrides: Partial<HomeDashboard> = {}): HomeDashboard {
  return {
    tiles: [
      { key: 'total-products', label: 'Total productos', href: '/products', state: 'ready', value: 56, format: 'count' },
      { key: 'inventory-value', label: 'Valor total de inventario', href: '/inventory', state: 'ready', value: 20630, format: 'currency', currency: 'USD' },
      { key: 'net-cost-month', label: 'Costo neto (octubre)', href: '/sales', state: 'ready', value: 1640, format: 'currency', currency: 'USD', sub: 'Ganancia: $1.251,00' },
    ],
    highlights: [
      { key: 'sales-today', label: 'Ventas de hoy', href: '/sales', state: 'ready', value: 0, accent: 'emerald', currency: 'USD' },
      { key: 'sales-month', label: 'Ventas de octubre', href: '/sales', state: 'ready', value: 2891, accent: 'indigo', currency: 'USD' },
      { key: 'sales-year', label: 'Ventas del 2026', href: '/sales', state: 'ready', value: 3185, accent: 'orange', currency: 'USD' },
    ],
    trend: { state: 'ready', year: 2026, years: [2026], hasCost: true, points: [] },
    topProducts: { state: 'ready', items: [] },
    locationOptions: [{ id: 'l1', name: 'Matriz · General' }],
    ...overrides,
  } as HomeDashboard;
}

describe('HomeMobile', () => {
  it('shows the hero: greeting with the first name, title, year, month sales, costo neto and ganancia', () => {
    render(<HomeMobile fullName="QA Admin Uno" dashboard={dashboard()} />);
    expect(screen.getByText('Hola, QA')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.getByText('Ventas de octubre')).toBeInTheDocument();
    expect(screen.getByText('Costo neto (octubre)')).toBeInTheDocument();
    expect(screen.getByText('$1.251,00')).toBeInTheDocument();
    expect(screen.getByLabelText('Almacén')).toBeInTheDocument();
  });

  it('lists Ventas (hoy, año) and Inventario (valor total, productos) as rows linking to their screens', () => {
    render(<HomeMobile fullName="QA" dashboard={dashboard()} />);
    expect(screen.getByRole('link', { name: /Ventas de hoy/ })).toHaveAttribute('href', '/sales');
    expect(screen.getByText('Total del día')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ventas del 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Valor total de inventario/ })).toHaveAttribute('href', '/inventory');
    const products = screen.getByRole('link', { name: /Productos/ });
    expect(products).toHaveAttribute('href', '/products');
    expect(products).toHaveTextContent('56');
    expect(screen.getByTestId('trend')).toBeInTheDocument();
  });

  it('a card without access is not rendered; an unavailable one shows "—", never a 0', () => {
    const d = dashboard();
    d.tiles = d.tiles.filter((t) => t.key !== 'net-cost-month').map((t) => (t.key === 'total-products' ? { ...t, state: 'unavailable' as const } : t));
    d.highlights = d.highlights.map((h) => (h.key === 'sales-year' ? { ...h, state: 'no-access' as const } : h));
    render(<HomeMobile fullName="QA" dashboard={d} />);
    expect(screen.queryByText('Costo neto (octubre)')).not.toBeInTheDocument();
    expect(screen.queryByText('Ganancia')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ventas del 2026/)).not.toBeInTheDocument();
    const products = screen.getByRole('link', { name: /Productos/ });
    expect(products).toHaveTextContent('—');
    expect(products).toHaveTextContent('No disponible por ahora');
  });

  it('keeps the almacén note on Productos when an almacén is chosen', () => {
    const d = dashboard();
    d.tiles = d.tiles.map((t) => (t.key === 'total-products' ? { ...t, note: 'Con existencias en este almacén' } : t));
    render(<HomeMobile fullName="QA" dashboard={d} />);
    expect(screen.getByRole('link', { name: /Productos/ })).toHaveTextContent('Con existencias en este almacén');
  });
});
