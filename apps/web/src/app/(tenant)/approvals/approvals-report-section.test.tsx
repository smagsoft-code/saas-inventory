import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApprovalsReportError, ApprovalsSummaryCards, summarizeApprovals } from './approvals-report-section';
import type { ApprovalsPeriodBucket, ApprovalsSummary } from '../../../lib/types/approvals-reports';

function bucket(overrides: Partial<ApprovalsPeriodBucket> = {}): ApprovalsPeriodBucket {
  return {
    key: '2026-10-13',
    requestCount: 4,
    approvedCount: 3,
    rejectedCount: 1,
    cancelledCount: 0,
    pendingCount: 0,
    approvedDiscountValue: 180,
    approvalRate: 0.75,
    ...overrides,
  };
}

function summary(buckets: ApprovalsPeriodBucket[]): ApprovalsSummary {
  return {
    from: '2026-10-13T05:00:00.000Z',
    to: '2026-10-14T05:00:00.000Z',
    timezone: 'America/Bogota',
    currency: 'USD',
    groupBy: 'day',
    buckets,
  };
}

describe('summarizeApprovals', () => {
  it('sums day buckets and recomputes the rate from summed approved/rejected (not an average)', () => {
    const result = summarizeApprovals([
      bucket({ requestCount: 4, approvedCount: 3, rejectedCount: 1, pendingCount: 0, approvedDiscountValue: 180 }),
      bucket({ key: '2026-10-14', requestCount: 2, approvedCount: 0, rejectedCount: 1, pendingCount: 1, approvedDiscountValue: 0 }),
    ]);
    expect(result).toEqual({ requestCount: 6, approvalRate: 0.6, pending: 1, approvedDiscountValue: 180 });
  });

  it('rate is null when nothing has been decided', () => {
    expect(summarizeApprovals([bucket({ approvedCount: 0, rejectedCount: 0, pendingCount: 2, requestCount: 2 })]).approvalRate).toBeNull();
    expect(summarizeApprovals([]).approvalRate).toBeNull();
  });
});

describe('ApprovalsSummaryCards', () => {
  it('shows the four cards with their values and no period table', () => {
    render(<ApprovalsSummaryCards summary={summary([bucket()])} />);
    expect(screen.getByText('Solicitudes')).toBeInTheDocument();
    expect(screen.getByText('Tasa de aprobación')).toBeInTheDocument();
    expect(screen.getByText('Pendientes')).toBeInTheDocument();
    expect(screen.getByText('Descuento aprobado')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('180.00 USD')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('empty period shows real zeros and a dash for the rate', () => {
    render(<ApprovalsSummaryCards summary={summary([])} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0.00 USD')).toBeInTheDocument();
  });
});

describe('ApprovalsReportError', () => {
  it('shows an access-denied title for a 403 — never a redirect to login', () => {
    render(<ApprovalsReportError status={403} message="You do not have permission." />);
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
  });

  it('shows a friendly title and the correlation id for a 5xx', () => {
    render(<ApprovalsReportError status={500} message="Something went wrong on our end." correlationId="corr-123" />);
    expect(screen.getByText('Algo salió mal de nuestro lado')).toBeInTheDocument();
    expect(screen.getByText(/corr-123/)).toBeInTheDocument();
  });

  it('offers a retry link back to #report', () => {
    render(<ApprovalsReportError status={400} message="Some of the information provided is invalid." />);
    expect(screen.getByRole('link', { name: 'Reintentar' })).toHaveAttribute('href', '#report');
  });
});
