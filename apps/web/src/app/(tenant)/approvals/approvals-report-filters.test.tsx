import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovalsReportFilters } from './approvals-report-filters';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const initial = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z', groupBy: 'day' as const, status: '' };

describe('ApprovalsReportFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders the initial from/to/groupBy/status values', () => {
    render(<ApprovalsReportFilters initial={initial} />);
    expect(screen.getByLabelText('From')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-08-31');
    expect(screen.getByLabelText('Group by')).toHaveValue('day');
    expect(screen.getByLabelText('Status')).toHaveValue('');
  });

  it('offers an "All statuses" option and every real status', () => {
    render(<ApprovalsReportFilters initial={initial} />);
    const select = screen.getByLabelText('Status');
    expect(select).toContainHTML('All statuses');
    for (const s of ['Pending', 'Approved', 'Rejected', 'Cancelled']) {
      expect(select).toContainHTML(s);
    }
  });

  it('navigates with reportGroupBy on a groupBy change, preserving the current dates', () => {
    render(<ApprovalsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'status' } });
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('reportGroupBy=status'));
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportFrom=2026-08-01T00%3A00%3A00.000Z');
  });

  it('sets reportStatus on a status change', () => {
    render(<ApprovalsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    expect(pushMock.mock.calls[0]![0] as string).toContain('reportStatus=approved');
  });

  it('omits reportStatus entirely when "All statuses" is chosen', () => {
    render(<ApprovalsReportFilters initial={{ ...initial, status: 'approved' }} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    expect(pushMock.mock.calls[0]![0] as string).not.toContain('reportStatus=');
  });

  it('sends `to` as the start of the NEXT day, so the picked end date is fully included ([from, to))', () => {
    render(<ApprovalsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(`reportTo=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`);
  });

  it('navigates to /approvals with a #report anchor, never off the approvals page', () => {
    render(<ApprovalsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'week' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/approvals?')).toBe(true);
    expect(url.endsWith('#report')).toBe(true);
  });
});
