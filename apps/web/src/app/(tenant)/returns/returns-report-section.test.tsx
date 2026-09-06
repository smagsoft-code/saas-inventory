import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReturnsReportError, ReturnsReportSection } from './returns-report-section';
import type { ReturnsSummary } from '../../../lib/types/returns-reports';

function baseSummary(overrides: Partial<ReturnsSummary> = {}): ReturnsSummary {
  return {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-31T00:00:00.000Z',
    timezone: 'America/Bogota',
    currency: 'USD',
    groupBy: 'day',
    buckets: [],
    ...overrides,
  };
}

describe('ReturnsReportSection', () => {
  it('shows an empty state when there are no buckets — never a fake zero table', () => {
    render(<ReturnsReportSection summary={baseSummary()} currency="USD" />);
    expect(screen.getByText('No returns in this period')).toBeInTheDocument();
  });

  it('renders period rows with real Returns/Units returned/Returned value/Avg per return KPI tiles', () => {
    const summary = baseSummary({
      groupBy: 'day',
      buckets: [
        { key: '2026-08-01', returnCount: 2, orderCount: 2, lineCount: 2, quantity: 5, returnedValue: 200, avgReturnValue: 100 },
      ],
    });
    render(<ReturnsReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    // KPI strip's "Returned value" tile and the table row both show the (single-bucket) total.
    expect(screen.getAllByText('200.00 USD')).toHaveLength(2);
  });

  it('renders product buckets with SKU/quantity columns, never an "Avg per return" KPI tile', () => {
    const summary = baseSummary({
      groupBy: 'product',
      buckets: [
        { key: 'variant-1', sku: 'SKU-1', productName: 'Widget', returnCount: 3, orderCount: 3, lineCount: 3, quantity: 7, returnedValue: 700 },
      ],
    });
    render(<ReturnsReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.queryByText('Avg per return')).not.toBeInTheDocument();
  });

  it('renders customer buckets with the frozen customer name', () => {
    const summary = baseSummary({
      groupBy: 'customer',
      buckets: [
        { key: 'cust-1', customerName: 'Acme Corp', returnCount: 4, orderCount: 4, lineCount: 4, quantity: 8, returnedValue: 400, avgReturnValue: 100 },
      ],
    });
    render(<ReturnsReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('renders disposition buckets with a labeled disposition, never a "Returns" KPI tile', () => {
    const summary = baseSummary({
      groupBy: 'disposition',
      buckets: [{ key: 'restock', lineCount: 3, quantity: 6, returnedValue: 300 }],
    });
    render(<ReturnsReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('Restock (sellable)')).toBeInTheDocument();
    expect(screen.getAllByText('Lines').length).toBeGreaterThan(0);
    expect(screen.queryByText('Returns')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg per return')).not.toBeInTheDocument();
  });
});

describe('ReturnsReportError', () => {
  it('shows an access-denied title for a 403 — never a redirect to login', () => {
    render(<ReturnsReportError status={403} message="You don't have permission to do that." />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to do that.")).toBeInTheDocument();
  });

  it('shows a friendly title and the correlation id for a 5xx', () => {
    render(<ReturnsReportError status={500} message="Something went wrong on our end. Please try again." correlationId="corr-123" />);
    expect(screen.getByText('Something went wrong on our end')).toBeInTheDocument();
    expect(screen.getByText(/corr-123/)).toBeInTheDocument();
  });

  it('offers a retry link back to #report', () => {
    render(<ReturnsReportError status={400} message="Some of the information provided is invalid." />);
    const retry = screen.getByRole('link', { name: 'Try again' });
    expect(retry).toHaveAttribute('href', '#report');
  });
});
