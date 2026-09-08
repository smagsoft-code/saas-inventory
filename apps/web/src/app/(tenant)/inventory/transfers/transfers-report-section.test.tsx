import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransfersReportError, TransfersReportSection } from './transfers-report-section';
import type { TransfersSummary } from '../../../../lib/types/inventory-reports';

function baseSummary(overrides: Partial<TransfersSummary> = {}): TransfersSummary {
  return {
    generatedAt: '2026-09-08T12:00:00.000Z',
    groupBy: 'status',
    totals: { inTransitQuantity: 0, openTransferCount: 0 },
    buckets: [],
    ...overrides,
  };
}

describe('TransfersReportSection', () => {
  it('always shows the groupBy-independent in-transit + open-transfer KPI tiles', () => {
    render(<TransfersReportSection summary={baseSummary({ totals: { inTransitQuantity: 42, openTransferCount: 3 } })} />);
    expect(screen.getByText('Units in transit')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Open transfers')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows a status-specific empty state for the status grouping', () => {
    render(<TransfersReportSection summary={baseSummary({ groupBy: 'status' })} />);
    expect(screen.getByText('No transfers yet')).toBeInTheDocument();
  });

  it('shows an in-transit empty state for the destination grouping — never a fake zero row', () => {
    render(<TransfersReportSection summary={baseSummary({ groupBy: 'destination' })} />);
    expect(screen.getByText('Nothing in transit')).toBeInTheDocument();
  });

  it('renders status buckets with the human status label and count', () => {
    const summary = baseSummary({
      groupBy: 'status',
      buckets: [
        { key: 'draft', transferCount: 2 },
        { key: 'dispatched', transferCount: 1 },
      ],
    });
    render(<TransfersReportSection summary={summary} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument(); // column header
  });

  it('renders destination buckets with the resolved name, in-transit qty and open count', () => {
    const summary = baseSummary({
      groupBy: 'destination',
      totals: { inTransitQuantity: 15, openTransferCount: 1 },
      buckets: [{ key: 'loc-1', destinationName: 'Store A', inTransitQuantity: 15, openTransferCount: 1 }],
    });
    render(<TransfersReportSection summary={summary} />);
    expect(screen.getByText('Store A')).toBeInTheDocument();
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(screen.getAllByText('15').length).toBeGreaterThanOrEqual(1);
  });

  it('renders variant buckets with product name + sku', () => {
    const summary = baseSummary({
      groupBy: 'variant',
      totals: { inTransitQuantity: 7, openTransferCount: 1 },
      buckets: [{ key: 'var-1', sku: 'SKU-1', productName: 'Widget', inTransitQuantity: 7 }],
    });
    render(<TransfersReportSection summary={summary} />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument(); // column header
  });
});

describe('TransfersReportError', () => {
  it('shows "Access denied" for a 403 and never renders a link to login', () => {
    render(<TransfersReportError status={403} message="You do not have permission." />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '#report');
    expect(screen.queryByRole('link', { name: /login/i })).not.toBeInTheDocument();
  });

  it('shows a generic message for a 5xx and the correlation id', () => {
    render(<TransfersReportError status={500} message="Something went wrong on our end." correlationId="abc-123" />);
    expect(screen.getByText('Something went wrong on our end')).toBeInTheDocument();
    expect(screen.getByText('Reference: abc-123')).toBeInTheDocument();
  });
});
