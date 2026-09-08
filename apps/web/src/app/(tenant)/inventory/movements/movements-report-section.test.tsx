import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MovementsReportError, MovementsReportSection } from './movements-report-section';
import type { MovementsSummary } from '../../../../lib/types/inventory-reports';

function baseSummary(overrides: Partial<MovementsSummary> = {}): MovementsSummary {
  return {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
    timezone: 'America/Bogota',
    groupBy: 'day',
    buckets: [],
    ...overrides,
  };
}

describe('MovementsReportSection', () => {
  it('shows an empty state when there are no buckets — never a fake zero row', () => {
    render(<MovementsReportSection summary={baseSummary()} />);
    expect(screen.getByText('No movements in this period')).toBeInTheDocument();
  });

  it('renders period buckets with the raw YYYY-MM-DD key, count and signed net quantity', () => {
    const summary = baseSummary({
      groupBy: 'day',
      buckets: [
        { key: '2026-08-01', movementCount: 3, totalQuantity: 40 },
        { key: '2026-08-02', movementCount: 2, totalQuantity: -5 },
      ],
    });
    render(<MovementsReportSection summary={summary} />);
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    expect(screen.getByText('Period')).toBeInTheDocument(); // column header
    // "Movements" is both a KPI label and a column header
    expect(screen.getAllByText('Movements').length).toBeGreaterThanOrEqual(2);
    // KPI: net quantity 40 + (-5) = 35
    expect(screen.getByText('+35')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument(); // the negative bucket, rendered signed
  });

  it('renders type buckets with the human movement-type label', () => {
    const summary = baseSummary({
      groupBy: 'type',
      buckets: [
        { key: 'RECEIPT', movementCount: 4, totalQuantity: 120 },
        { key: 'ADJUSTMENT_OUT', movementCount: 1, totalQuantity: -3 },
      ],
    });
    render(<MovementsReportSection summary={summary} />);
    expect(screen.getByText('Receipt')).toBeInTheDocument();
    expect(screen.getByText('Adjustment out')).toBeInTheDocument();
    expect(screen.getByText('Movement type')).toBeInTheDocument(); // column header
    expect(screen.getByText('Types')).toBeInTheDocument(); // KPI label switches for type grouping
  });
});

describe('MovementsReportError', () => {
  it('shows "Access denied" for a 403 and never renders a link to login', () => {
    render(<MovementsReportError status={403} message="You do not have permission." />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '#report');
    expect(screen.queryByRole('link', { name: /login/i })).not.toBeInTheDocument();
  });

  it('shows a generic message for a 5xx without echoing a body', () => {
    render(<MovementsReportError status={500} message="Something went wrong on our end." correlationId="abc-123" />);
    expect(screen.getByText('Something went wrong on our end')).toBeInTheDocument();
    expect(screen.getByText('Reference: abc-123')).toBeInTheDocument();
  });
});
