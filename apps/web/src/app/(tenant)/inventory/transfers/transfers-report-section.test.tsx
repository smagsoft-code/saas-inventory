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
  it('shows the in-transit + open-transfer KPI tiles only — no "Agrupar por" selector or breakdown table', () => {
    render(<TransfersReportSection summary={baseSummary({ totals: { inTransitQuantity: 42, openTransferCount: 3 } })} />);
    expect(screen.getByText('Unidades en tránsito')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Transferencias abiertas')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('Agrupar por')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('ignores whatever buckets the backend still sends — never rendered', () => {
    const summary = baseSummary({
      groupBy: 'status',
      buckets: [
        { key: 'draft', transferCount: 2 },
        { key: 'dispatched', transferCount: 1 },
      ],
    });
    render(<TransfersReportSection summary={summary} />);
    expect(screen.queryByText('Borrador')).not.toBeInTheDocument();
    expect(screen.queryByText('Despachada')).not.toBeInTheDocument();
  });
});

describe('TransfersReportError', () => {
  it('shows "Access denied" for a 403 and never renders a link to login', () => {
    render(<TransfersReportError status={403} message="You do not have permission." />);
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reintentar' })).toHaveAttribute('href', '#report');
    expect(screen.queryByRole('link', { name: /login/i })).not.toBeInTheDocument();
  });

  it('shows a generic message for a 5xx and the correlation id', () => {
    render(<TransfersReportError status={500} message="Something went wrong on our end." correlationId="abc-123" />);
    expect(screen.getByText('Algo salió mal de nuestro lado')).toBeInTheDocument();
    expect(screen.getByText('Referencia: abc-123')).toBeInTheDocument();
  });
});
