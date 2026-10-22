import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SalesReportError, SalesSummaryCards, summarizeSales } from './sales-report-section';
import type { SalesSummary } from '../../../lib/types/reports';

function baseSummary(overrides: Partial<SalesSummary> = {}): SalesSummary {
  return {
    from: '2026-10-13T05:00:00.000Z',
    to: '2026-10-14T05:00:00.000Z',
    timezone: 'America/Bogota',
    currency: 'USD',
    groupBy: 'day',
    exceptional: 'all',
    buckets: [],
    ...overrides,
  };
}

describe('summarizeSales', () => {
  it('sums day buckets: sin descuento = subtotal + descuentos, netas = total, pedidos = count', () => {
    const summary = baseSummary({
      buckets: [
        { key: '2026-10-13', orderCount: 2, subtotal: 220, discountTotal: 20, total: 220, avgTicket: 110 },
        { key: '2026-10-14', orderCount: 1, subtotal: 100, discountTotal: 0, total: 100, avgTicket: 100 },
      ],
    });
    expect(summarizeSales(summary)).toEqual({ withoutDiscount: 340, discounts: 20, net: 320, orderCount: 3 });
  });

  it('is exact to the cent (no float drift)', () => {
    const summary = baseSummary({
      buckets: [
        { key: 'a', orderCount: 1, subtotal: 0.1, discountTotal: 0.2, total: 0.1, avgTicket: 0.1 },
        { key: 'b', orderCount: 1, subtotal: 0.2, discountTotal: 0.1, total: 0.2, avgTicket: 0.2 },
      ],
    });
    expect(summarizeSales(summary)).toEqual({ withoutDiscount: 0.6, discounts: 0.3, net: 0.3, orderCount: 2 });
  });

  it('empty period is real zeros', () => {
    expect(summarizeSales(baseSummary())).toEqual({ withoutDiscount: 0, discounts: 0, net: 0, orderCount: 0 });
  });
});

describe('SalesSummaryCards', () => {
  it('shows exactly the four approved cards and no Periodo table', () => {
    render(
      <SalesSummaryCards
        statusLabel="confirmados"
        summary={baseSummary({
          buckets: [{ key: '2026-10-13', orderCount: 2, subtotal: 220, discountTotal: 20, total: 220, avgTicket: 110 }],
        })}
      />,
    );
    expect(screen.getByText('Ventas sin descuento')).toBeInTheDocument();
    expect(screen.getByText('Descuentos')).toBeInTheDocument();
    expect(screen.getByText('Ventas netas')).toBeInTheDocument();
    expect(screen.getByText('Cantidad de pedidos')).toBeInTheDocument();
    expect(screen.getByText('240.00 USD')).toBeInTheDocument();
    expect(screen.getByText('20.00 USD')).toBeInTheDocument();
    expect(screen.getByText('220.00 USD')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Ticket promedio')).not.toBeInTheDocument();
    expect(screen.queryByText('Periodo')).not.toBeInTheDocument();
  });

  it('shows zeros (not an empty state) for a period with no orders, and names the counted status', () => {
    render(<SalesSummaryCards statusLabel="pendientes" summary={baseSummary()} />);
    expect(screen.getAllByText('0.00 USD')).toHaveLength(3);
    expect(screen.getByText('0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }));
    expect(screen.getByText(/pedidos pendientes/)).toBeInTheDocument();
    expect(screen.getByText(/No restan devoluciones/)).toBeInTheDocument();
  });
});

describe('SalesReportError', () => {
  it('shows an access-denied title for a 403 — never a redirect to login', () => {
    render(<SalesReportError status={403} message="You don't have permission to do that." />);
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to do that.")).toBeInTheDocument();
  });

  it('shows a friendly title and the correlation id for a 5xx', () => {
    render(<SalesReportError status={500} message="Something went wrong on our end. Please try again." correlationId="corr-123" />);
    expect(screen.getByText('Algo salió mal de nuestro lado')).toBeInTheDocument();
    expect(screen.getByText('Referencia: corr-123')).toBeInTheDocument();
  });
});
