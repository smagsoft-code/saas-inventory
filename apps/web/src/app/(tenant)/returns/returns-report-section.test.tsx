import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReturnsReportError, ReturnsSummaryCards, summarizeReturns } from './returns-report-section';
import type { ReturnsPeriodBucket, ReturnsSummary } from '../../../lib/types/returns-reports';

function bucket(overrides: Partial<ReturnsPeriodBucket> = {}): ReturnsPeriodBucket {
  return { key: '2026-10-13', returnCount: 2, orderCount: 2, lineCount: 2, quantity: 5, returnedValue: 200, avgReturnValue: 100, ...overrides };
}

function summary(buckets: ReturnsPeriodBucket[]): ReturnsSummary {
  return {
    from: '2026-10-13T05:00:00.000Z',
    to: '2026-10-14T05:00:00.000Z',
    timezone: 'America/Bogota',
    currency: 'USD',
    groupBy: 'day',
    buckets,
  };
}

describe('summarizeReturns', () => {
  it('sums day buckets and recomputes the average from the totals', () => {
    expect(
      summarizeReturns([bucket(), bucket({ key: '2026-10-14', returnCount: 1, quantity: 1, returnedValue: 100 })]),
    ).toEqual({ returnCount: 3, quantity: 6, returnedValue: 300, avgReturnValue: 100 });
  });

  it('an empty period is real zeros', () => {
    expect(summarizeReturns([])).toEqual({ returnCount: 0, quantity: 0, returnedValue: 0, avgReturnValue: 0 });
  });
});

describe('ReturnsSummaryCards', () => {
  it('keeps the same four cards and has no period table', () => {
    render(<ReturnsSummaryCards statusLabel="resueltas" summary={summary([bucket()])} />);
    expect(screen.getByText('Devoluciones')).toBeInTheDocument();
    expect(screen.getByText('Unidades devueltas')).toBeInTheDocument();
    expect(screen.getByText('Valor devuelto')).toBeInTheDocument();
    expect(screen.getByText('Promedio por devolución')).toBeInTheDocument();
    expect(screen.getAllByText('200.00 USD')).toHaveLength(1);
    expect(screen.getByText('100.00 USD')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('names the counted status and says the value is not a refund', () => {
    render(<ReturnsSummaryCards statusLabel="solicitadas" summary={summary([])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }));
    expect(screen.getByText(/devoluciones solicitadas/)).toBeInTheDocument();
    expect(screen.getByText(/no es un reembolso/)).toBeInTheDocument();
  });
});

describe('ReturnsReportError', () => {
  it('shows an access-denied title for a 403 — never a redirect to login', () => {
    render(<ReturnsReportError status={403} message="No tienes permiso para hacer esto." />);
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
    expect(screen.getByText('No tienes permiso para hacer esto.')).toBeInTheDocument();
  });

  it('shows a friendly title and the correlation id for a 5xx', () => {
    render(<ReturnsReportError status={500} message="Something went wrong on our end." correlationId="corr-123" />);
    expect(screen.getByText('Algo salió mal de nuestro lado')).toBeInTheDocument();
    expect(screen.getByText(/corr-123/)).toBeInTheDocument();
  });

  it('offers a retry link back to #report', () => {
    render(<ReturnsReportError status={400} message="Some of the information provided is invalid." />);
    expect(screen.getByRole('link', { name: 'Reintentar' })).toHaveAttribute('href', '#report');
  });
});
