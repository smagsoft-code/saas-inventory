import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeKpiCard, HomeKpiGrid, HomeTopProducts } from './home-dashboard';
import type { HomeTile, HomeTopProductsCard } from '../../lib/home/dashboard';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function baseTile(overrides: Partial<HomeTile>): HomeTile {
  return {
    key: 'k',
    label: 'Ventas del día',
    href: '/sales',
    state: 'ready',
    value: 0,
    format: 'count',
    ...overrides,
  };
}

describe('HomeKpiCard', () => {
  it('shows a plain count for a ready count tile', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'ready', value: 12, format: 'count' })} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/sales');
  });

  it('renders a real zero, not a dash', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'ready', value: 0, format: 'count' })} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('formats a currency tile with the given currency code', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'ready', value: 480.5, format: 'currency', currency: 'USD' })} />);
    expect(screen.getByText('480.50 USD')).toBeInTheDocument();
  });

  it('renders a currency tile without a suffix when no currency is known', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'ready', value: 999, format: 'currency' })} />);
    expect(screen.getByText('999.00')).toBeInTheDocument();
  });

  it('shows "—" and a note for an unavailable tile — never a fake 0', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'unavailable', value: 0 })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/no disponible/i)).toBeInTheDocument();
  });

  it('shows a note for a ready tile when one is provided (e.g. missing costs)', () => {
    render(
      <HomeKpiCard
        tile={baseTile({ state: 'ready', value: 500, format: 'currency', note: '3 variante(s) sin costo cargado, excluida(s) del total.' })}
      />,
    );
    expect(screen.getByText(/3 variante\(s\) sin costo cargado/)).toBeInTheDocument();
  });
});

describe('HomeKpiGrid', () => {
  it('renders one card per tile', () => {
    render(
      <HomeKpiGrid
        tiles={[baseTile({ key: 'a', label: 'A' }), baseTile({ key: 'b', label: 'B' })]}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('shows a friendly empty state when the user can see no tiles', () => {
    render(<HomeKpiGrid tiles={[]} />);
    expect(screen.getByText(/sin módulos operativos/i)).toBeInTheDocument();
  });
});

function topCard(overrides: Partial<HomeTopProductsCard> = {}): HomeTopProductsCard {
  return { state: 'ready', items: [], ...overrides };
}

describe('HomeTopProducts', () => {
  it('lists items ranked in the given order with quantity sold', () => {
    render(
      <HomeTopProducts
        card={topCard({
          items: [
            { variantId: 'v1', sku: 'SKU-1', productName: 'Widget', quantity: 14 },
            { variantId: 'v2', sku: 'SKU-2', productName: 'Gadget', quantity: 9 },
          ],
        })}
      />,
    );
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('Gadget')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('shows a calm message when nothing sold today, not an empty table', () => {
    render(<HomeTopProducts card={topCard({ items: [] })} />);
    expect(screen.getByText(/aún no hay ventas registradas hoy/i)).toBeInTheDocument();
  });

  it('shows an honest unavailable message rather than an empty list', () => {
    render(<HomeTopProducts card={topCard({ state: 'unavailable', items: [] })} />);
    expect(screen.getByText(/no se pudo determinar/i)).toBeInTheDocument();
  });
});
