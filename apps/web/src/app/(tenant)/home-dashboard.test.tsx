import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeHighlightCard, HomeHighlights, HomeKpiCard, HomeKpiGrid, HomeTopProducts } from './home-dashboard';
import { HomeLocationFilter } from './home-location-filter';
import type { HomeHighlight, HomeTile, HomeTopProductsCard } from '../../lib/home/dashboard';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

function baseTile(overrides: Partial<HomeTile>): HomeTile {
  return { key: 'k', label: 'Total productos', href: '/products', state: 'ready', value: 0, format: 'count', ...overrides };
}

function baseHighlight(overrides: Partial<HomeHighlight>): HomeHighlight {
  return { key: 'h', label: 'Ventas de hoy', href: '/sales', state: 'ready', value: 0, accent: 'emerald', ...overrides };
}

afterEach(() => cleanup());

describe('HomeKpiCard', () => {
  it('shows a plain count and links to its module', () => {
    render(<HomeKpiCard tile={baseTile({ value: 33, icon: 'box', tone: 'indigo' })} />);
    expect(screen.getByText('33')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/products');
  });

  it('renders a real zero, not a dash', () => {
    render(<HomeKpiCard tile={baseTile({ value: 0 })} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('formats money like $48.668,50', () => {
    render(<HomeKpiCard tile={baseTile({ value: 48668.5, format: 'currency', currency: 'USD' })} />);
    expect(screen.getByText('$48.668,50')).toBeInTheDocument();
  });

  it('shows the secondary line (ganancia) and the note', () => {
    render(<HomeKpiCard tile={baseTile({ format: 'currency', value: 10, sub: 'Ganancia: $5,00', note: '2 línea(s) sin costo' })} />);
    expect(screen.getByText('Ganancia: $5,00')).toBeInTheDocument();
    expect(screen.getByText('2 línea(s) sin costo')).toBeInTheDocument();
  });

  it('shows "No disponible por ahora" (never 0) when the read failed', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'unavailable' })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No disponible por ahora')).toBeInTheDocument();
  });
});

describe('HomeKpiGrid', () => {
  it('renders one card per tile', () => {
    render(<HomeKpiGrid tiles={[baseTile({ key: 'a', label: 'A' }), baseTile({ key: 'b', label: 'B' })]} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('shows an explanatory empty state when the role sees no cards', () => {
    render(<HomeKpiGrid tiles={[]} />);
    expect(screen.getByText('Sin módulos operativos para tu rol')).toBeInTheDocument();
  });
});

describe('Highlight cards (hoy / mes / año)', () => {
  it('renders the label and the formatted amount', () => {
    render(<HomeHighlightCard highlight={baseHighlight({ label: 'Ventas del 2026', value: 9965.5, currency: 'USD', accent: 'orange' })} />);
    expect(screen.getByText('Ventas del 2026')).toBeInTheDocument();
    expect(screen.getByText('$9.965,50')).toBeInTheDocument();
  });

  it('shows a real zero for no sales, and "No disponible" when the read failed', () => {
    const { rerender } = render(<HomeHighlightCard highlight={baseHighlight({ value: 0, currency: 'USD' })} />);
    expect(screen.getByText('$0,00')).toBeInTheDocument();
    rerender(<HomeHighlightCard highlight={baseHighlight({ state: 'unavailable' })} />);
    expect(screen.getByText('No disponible por ahora')).toBeInTheDocument();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<HomeHighlights highlights={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HomeTopProducts', () => {
  it('shows a ranked list', () => {
    const card: HomeTopProductsCard = { state: 'ready', items: [{ variantId: 'v1', sku: 'A-1', productName: 'Widget', quantity: 7 }] };
    render(<HomeTopProducts card={card} />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows an honest empty message', () => {
    render(<HomeTopProducts card={{ state: 'ready', items: [] }} />);
    expect(screen.getByText('Aún no hay ventas registradas hoy.')).toBeInTheDocument();
  });

  it('shows an unavailable message when the read failed', () => {
    render(<HomeTopProducts card={{ state: 'unavailable', items: [] }} />);
    expect(screen.getByText(/no se pudo determinar/i)).toBeInTheDocument();
  });
});

describe('HomeLocationFilter', () => {
  const options = [
    { id: 'l1', name: 'Matriz · General' },
    { id: 'l2', name: 'Norte · Bodega' },
  ];

  it('offers "Todos" plus only the options it was given', () => {
    render(<HomeLocationFilter options={options} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos los almacenes', 'Matriz · General', 'Norte · Bodega']);
  });

  it('navigates with the chosen locationId, and back to the bare URL for "Todos"', () => {
    pushMock.mockClear();
    render(<HomeLocationFilter options={options} selectedLocationId="l1" />);
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'l2' } });
    expect(pushMock).toHaveBeenLastCalledWith('/?locationId=l2');
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: '' } });
    expect(pushMock).toHaveBeenLastCalledWith('/');
  });
});
