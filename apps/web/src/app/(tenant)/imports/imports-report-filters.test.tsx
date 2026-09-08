import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImportsReportFilters } from './imports-report-filters';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const initial = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  groupBy: 'day' as const,
  status: '',
};

describe('ImportsReportFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders the initial from/to/groupBy/status values', () => {
    render(<ImportsReportFilters initial={initial} />);
    expect(screen.getByLabelText('From')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-08-31');
    expect(screen.getByLabelText('Group by')).toHaveValue('day');
    expect(screen.getByLabelText('Status')).toHaveValue('');
  });

  it('navigates with reportGroupBy on a groupBy change, preserving the dates, anchored at #report', () => {
    render(<ImportsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'status' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/imports?')).toBe(true);
    expect(url).toContain('reportGroupBy=status');
    expect(url).toContain('reportFrom=2026-08-01T00%3A00%3A00.000Z');
    expect(url.endsWith('#report')).toBe(true);
  });

  it('adds reportStatus only when a status is chosen', () => {
    render(<ImportsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed_with_errors' } });
    let url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportStatus=completed_with_errors');

    pushMock.mockClear();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('reportStatus');
  });

  it('sends `to` as the start of the NEXT day so the picked end date is fully included ([from, to))', () => {
    render(<ImportsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(`reportTo=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`);
  });
});
