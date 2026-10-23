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
    expect(screen.getByText('Trabajos completados')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Filas importadas')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('Filas inválidas')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('renders no per-period table, even when the endpoint returns buckets', () => {
    const summary = baseSummary({
      totals: { key: 'total', jobCount: 2, totalRows: 30, validRows: 28, invalidRows: 2, warningRows: 0, importedRows: 26 },
      buckets: [{ key: '2026-08-01', jobCount: 2, totalRows: 30, validRows: 28, invalidRows: 2, warningRows: 0, importedRows: 26 }],
    });
    render(<ImportsReportSection summary={summary} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-08-01')).not.toBeInTheDocument();
    expect(screen.queryByText('Período')).not.toBeInTheDocument();
  });
});

describe('ImportsReportError', () => {
  it('shows "Access denied" for a 403 and never renders a link to login', () => {
    render(<ImportsReportError status={403} message="You do not have permission." />);
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reintentar' })).toHaveAttribute('href', '#report');
    expect(screen.queryByRole('link', { name: /login/i })).not.toBeInTheDocument();
  });

  it('shows a generic message for a 5xx and the correlation id', () => {
    render(<ImportsReportError status={500} message="Something went wrong on our end." correlationId="abc-123" />);
    expect(screen.getByText('Algo salió mal de nuestro lado')).toBeInTheDocument();
    expect(screen.getByText('Referencia: abc-123')).toBeInTheDocument();
  });
});
