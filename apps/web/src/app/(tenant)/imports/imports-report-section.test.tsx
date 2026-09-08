import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImportsReportError, ImportsReportSection } from './imports-report-section';
import type { ImportsSummary, ImportsSummaryBucket } from '../../../lib/types/imports-reports';

const zero: ImportsSummaryBucket = { key: 'total', jobCount: 0, totalRows: 0, validRows: 0, invalidRows: 0, warningRows: 0, importedRows: 0 };

function baseSummary(overrides: Partial<ImportsSummary> = {}): ImportsSummary {
  return {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
    timezone: 'America/Bogota',
    groupBy: 'day',
    totals: zero,
    buckets: [],
    ...overrides,
  };
}

describe('ImportsReportSection', () => {
  it('renders the totals KPI tiles from the endpoint totals, not a client re-derivation', () => {
    render(
      <ImportsReportSection
        summary={baseSummary({ totals: { key: 'total', jobCount: 5, totalRows: 900, validRows: 850, invalidRows: 30, warningRows: 20, importedRows: 800 } })}
      />,
    );
    expect(screen.getByText('Jobs completed')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Rows imported')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('Rows invalid')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('shows an empty state (never a fake zero row) when there are no buckets', () => {
    render(<ImportsReportSection summary={baseSummary()} />);
    expect(screen.getByText('No completed imports in this period')).toBeInTheDocument();
  });

  it('renders period buckets with the raw YYYY-MM-DD key and every row-count column', () => {
    const summary = baseSummary({
      groupBy: 'day',
      totals: { key: 'total', jobCount: 2, totalRows: 30, validRows: 28, invalidRows: 2, warningRows: 0, importedRows: 26 },
      buckets: [
        { key: '2026-08-01', jobCount: 1, totalRows: 10, validRows: 9, invalidRows: 1, warningRows: 0, importedRows: 8 },
        { key: '2026-08-02', jobCount: 1, totalRows: 20, validRows: 19, invalidRows: 1, warningRows: 0, importedRows: 18 },
      ],
    });
    render(<ImportsReportSection summary={summary} />);
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    expect(screen.getByText('Period')).toBeInTheDocument(); // column header
  });

  it('renders status buckets with the human import-status label', () => {
    const summary = baseSummary({
      groupBy: 'status',
      totals: { key: 'total', jobCount: 3, totalRows: 30, validRows: 27, invalidRows: 3, warningRows: 0, importedRows: 24 },
      buckets: [
        { key: 'completed', jobCount: 2, totalRows: 20, validRows: 20, invalidRows: 0, warningRows: 0, importedRows: 20 },
        { key: 'completed_with_errors', jobCount: 1, totalRows: 10, validRows: 7, invalidRows: 3, warningRows: 0, importedRows: 4 },
      ],
    });
    render(<ImportsReportSection summary={summary} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Completed with errors')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument(); // column header
  });
});

describe('ImportsReportError', () => {
  it('shows "Access denied" for a 403 and never renders a link to login', () => {
    render(<ImportsReportError status={403} message="You do not have permission." />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '#report');
    expect(screen.queryByRole('link', { name: /login/i })).not.toBeInTheDocument();
  });

  it('shows a generic message for a 5xx and the correlation id', () => {
    render(<ImportsReportError status={500} message="Something went wrong on our end." correlationId="abc-123" />);
    expect(screen.getByText('Something went wrong on our end')).toBeInTheDocument();
    expect(screen.getByText('Reference: abc-123')).toBeInTheDocument();
  });
});
