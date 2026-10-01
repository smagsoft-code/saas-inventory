import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SalesReportError, SalesReportSection } from './sales-report-section';
import type { SalesSummary } from '../../../lib/types/reports';

function baseSummary(overrides: Partial<SalesSummary> = {}): SalesSummary {
  return {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-31T00:00:00.000Z',
    timezone: 'America/Bogota',
    currency: 'USD',
    groupBy: 'day',
    exceptional: 'all',
    buckets: [],
    ...overrides,
  };
}

describe('SalesReportSection', () => {
  it('shows an empty state when there are no buckets — never a fake zero table', () => {
    render(<SalesReportSection summary={baseSummary()} currency="USD" />);
    expect(screen.getByText('Sin ventas en este período')).toBeInTheDocument();
  });

  it('the empty state names the exceptional-discount filter when it is the active one (F18-06)', () => {
    render(<SalesReportSection summary={baseSummary({ exceptional: 'only' })} currency="USD" />);
    expect(screen.getByText('Sin ventas con descuento excepcional en este período')).toBeInTheDocument();
  });

  it('renders period rows with real Revenue/Orders/Avg ticket/Discounts KPI tiles (day/week/month)', () => {
    const summary = baseSummary({
      groupBy: 'day',
      buckets: [
        { key: '2026-08-01', orderCount: 2, subtotal: 300, discountTotal: 10, total: 290, avgTicket: 145 },
      ],
    });
    render(<SalesReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    // KPI strip's Revenue tile and the table row both show the (single-bucket) total — two matches.
    expect(screen.getAllByText('290.00 USD')).toHaveLength(2);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0); // orderCount appears in the KPI + the row
  });

  it('renders product buckets with SKU/quantity columns, never an "Orders" or "Avg ticket" KPI tile', () => {
    const summary = baseSummary({
      groupBy: 'product',
      buckets: [
        { key: 'variant-1', sku: 'SKU-1', productName: 'Widget', orderCount: 3, quantity: 7, discountTotal: 0, total: 700 },
      ],
    });
    render(<SalesReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('Unidades vendidas')).toBeInTheDocument();
    expect(screen.queryByText('Ticket promedio')).not.toBeInTheDocument();
    expect(screen.queryByText('Pedidos')).not.toBeInTheDocument();
  });

  it('renders customer buckets with the frozen customer name', () => {
    const summary = baseSummary({
      groupBy: 'customer',
      buckets: [
        { key: 'cust-1', customerName: 'Acme Corp', orderCount: 4, subtotal: 400, discountTotal: 0, total: 400, avgTicket: 100 },
      ],
    });
    render(<SalesReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
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
    expect(screen.getByText(/corr-123/)).toBeInTheDocument();
  });

  it('offers a retry link back to #report', () => {
    render(<SalesReportError status={400} message="Some of the information provided is invalid." />);
    const retry = screen.getByRole('link', { name: 'Reintentar' });
    expect(retry).toHaveAttribute('href', '#report');
  });
});
