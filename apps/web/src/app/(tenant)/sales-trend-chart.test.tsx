import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeSalesTrend } from '../../lib/home/dashboard';
import { SalesTrendChart } from './sales-trend-chart';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

function trend(overrides: Partial<HomeSalesTrend> = {}): HomeSalesTrend {
  return {
    state: 'ready',
    year: 2026,
    years: [2026, 2025, 2024],
    currency: 'USD',
    hasCost: true,
    points: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      sales: i < 10 ? (i + 1) * 100 : null,
      cost: i < 10 ? (i + 1) * 60 : null,
    })),
    ...overrides,
  };
}

describe('SalesTrendChart', () => {
  beforeEach(() => pushMock.mockClear());
  afterEach(() => cleanup());

  it('has a title, a legend naming both series, and a year picker with the offered years', () => {
    render(<SalesTrendChart trend={trend()} />);
    expect(screen.getByRole('heading', { name: 'Tendencia de ventas' })).toBeInTheDocument();
    const legend = screen.getByLabelText('Leyenda');
    expect(within(legend).getByText('Ventas')).toBeInTheDocument();
    expect(within(legend).getByText('Costo neto')).toBeInTheDocument();
    const select = screen.getByLabelText('Año') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['2026', '2025', '2024']);
    expect(select.value).toBe('2026');
  });

  it('colours sales with the primary colour and costs orange', () => {
    const { container } = render(<SalesTrendChart trend={trend()} />);
    const strokes = Array.from(container.querySelectorAll('path[stroke]')).map((p) => p.getAttribute('stroke'));
    expect(strokes).toContain('#0f172a');
    expect(strokes).toContain('#f97316');
  });

  it('shows only the Ventas series (no Costo legend, line or column) without cost permission', () => {
    const { container } = render(
      <SalesTrendChart trend={trend({ hasCost: false, points: trend().points.map((p) => ({ ...p, cost: null })) })} />,
    );
    expect(within(screen.getByLabelText('Leyenda')).queryByText('Costo neto')).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('path[stroke]')).map((p) => p.getAttribute('stroke'))).not.toContain('#f97316');
    expect(screen.queryByRole('columnheader', { name: 'Costo neto' })).not.toBeInTheDocument();
  });

  it('changing the year navigates with ?year=, keeping the Almacén filter', () => {
    render(<SalesTrendChart trend={trend()} locationId="loc-1" />);
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2025' } });
    expect(pushMock).toHaveBeenCalledWith('/?year=2025&locationId=loc-1');
    pushMock.mockClear();
    cleanup();
    render(<SalesTrendChart trend={trend()} />);
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2024' } });
    expect(pushMock).toHaveBeenCalledWith('/?year=2024');
  });

  it('the keyboard (arrow keys) moves a crosshair and one tooltip shows BOTH series for that month', () => {
    render(<SalesTrendChart trend={trend()} />);
    const chart = screen.getByRole('img');
    fireEvent.keyDown(chart, { key: 'ArrowRight' }); // Jan
    fireEvent.keyDown(chart, { key: 'ArrowRight' }); // Feb
    const tip = screen.getByRole('status');
    expect(within(tip).getByText('Febrero')).toBeInTheDocument();
    expect(within(tip).getByText('$200,00')).toBeInTheDocument(); // sales
    expect(within(tip).getByText('$120,00')).toBeInTheDocument(); // cost
    fireEvent.keyDown(chart, { key: 'Escape' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a month without data shows a dash, never zero', () => {
    render(<SalesTrendChart trend={trend()} />);
    const chart = screen.getByRole('img');
    for (let i = 0; i < 12; i += 1) fireEvent.keyDown(chart, { key: 'ArrowRight' }); // Dec
    const tip = screen.getByRole('status');
    expect(within(tip).getByText('Diciembre')).toBeInTheDocument();
    expect(within(tip).getAllByText('—')).toHaveLength(2);
  });

  it('has a table view with every month and value', () => {
    render(<SalesTrendChart trend={trend()} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13); // header + 12 months
    const october = within(within(table).getByRole('row', { name: /Octubre/ }));
    expect(october.getByText('$1.000,00')).toBeInTheDocument(); // sales
    expect(october.getByText('$600,00')).toBeInTheDocument(); // cost
  });

  it('shows an honest message when the read failed', () => {
    render(<SalesTrendChart trend={trend({ state: 'unavailable' })} />);
    expect(screen.getByText(/no se pudo cargar la tendencia/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
