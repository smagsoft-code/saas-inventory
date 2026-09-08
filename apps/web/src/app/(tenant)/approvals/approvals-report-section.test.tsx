import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApprovalsReportError, ApprovalsReportSection } from './approvals-report-section';
import type { ApprovalsSummary } from '../../../lib/types/approvals-reports';

function baseSummary(overrides: Partial<ApprovalsSummary> = {}): ApprovalsSummary {
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

describe('ApprovalsReportSection', () => {
  it('shows an empty state when there are no buckets — never a fake zero table', () => {
    render(<ApprovalsReportSection summary={baseSummary()} currency="USD" />);
    expect(screen.getByText('No approval requests in this period')).toBeInTheDocument();
  });

  it('renders period rows with Requests / Approval rate / Pending / Approved discount KPI tiles', () => {
    const summary = baseSummary({
      groupBy: 'day',
      buckets: [
        {
          key: '2026-08-01',
          requestCount: 4,
          approvedCount: 3,
          rejectedCount: 1,
          cancelledCount: 0,
          pendingCount: 0,
          approvedDiscountValue: 180,
          approvalRate: 0.75,
        },
      ],
    });
    render(<ApprovalsReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    // "Approval rate" is both a KPI tile label and a column header.
    expect(screen.getAllByText('Approval rate').length).toBeGreaterThan(0);
    // 0.75 -> "75.0%" appears in both the KPI tile and the table row.
    expect(screen.getAllByText('75.0%')).toHaveLength(2);
    expect(screen.getAllByText('180.00 USD')).toHaveLength(2);
  });

  it('renders an em dash for a null approval rate, never a fake 0%', () => {
    const summary = baseSummary({
      groupBy: 'day',
      buckets: [
        {
          key: '2026-08-02',
          requestCount: 3,
          approvedCount: 0,
          rejectedCount: 0,
          cancelledCount: 1,
          pendingCount: 2,
          approvedDiscountValue: 0,
          approvalRate: null,
        },
      ],
    });
    render(<ApprovalsReportSection summary={summary} currency="USD" />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });

  it('renders status buckets with a labeled status and a discount value, never an approval-rate column', () => {
    const summary = baseSummary({
      groupBy: 'status',
      buckets: [
        { key: 'approved', requestCount: 3, discountValue: 90 },
        { key: 'rejected', requestCount: 2, discountValue: 55 },
      ],
    });
    render(<ApprovalsReportSection summary={summary} currency="USD" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Statuses')).toBeInTheDocument();
    expect(screen.queryByText('Approval rate')).not.toBeInTheDocument();
  });
});

describe('ApprovalsReportError', () => {
  it('shows an access-denied title for a 403 — never a redirect to login', () => {
    render(<ApprovalsReportError status={403} message="You don't have permission to do that." />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('shows a friendly title and the correlation id for a 5xx', () => {
    render(<ApprovalsReportError status={500} message="Something went wrong on our end." correlationId="corr-123" />);
    expect(screen.getByText('Something went wrong on our end')).toBeInTheDocument();
    expect(screen.getByText(/corr-123/)).toBeInTheDocument();
  });

  it('offers a retry link back to #report', () => {
    render(<ApprovalsReportError status={400} message="Some of the information provided is invalid." />);
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '#report');
  });
});
