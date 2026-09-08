import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SalesReportFilters } from './sales-report-filters';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const initial = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  groupBy: 'day' as const,
  exceptional: 'all' as const,
};

describe('SalesReportFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders the initial from/to/groupBy values', () => {
    render(<SalesReportFilters initial={initial} />);
    expect(screen.getByLabelText('From')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-08-31');
    expect(screen.getByLabelText('Group by')).toHaveValue('day');
  });

  it('navigates with reportGroupBy on a groupBy change, preserving the current dates', () => {
    render(<SalesReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'product' } });
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('reportGroupBy=product'),
    );
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportFrom=2026-08-01T00%3A00%3A00.000Z');
  });

  it('sends `to` as the start of the NEXT day, so the picked end date is fully included ([from, to))', () => {
    render(<SalesReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(`reportTo=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`);
  });

  it('renders the exceptional-discount filter, defaulting to "all" (F18-06)', () => {
    render(<SalesReportFilters initial={initial} />);
    expect(screen.getByLabelText('Exceptional discount')).toHaveValue('all');
  });

  it('adds reportExceptional to the URL only when it is not "all" (F18-06)', () => {
    render(<SalesReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Exceptional discount'), { target: { value: 'only' } });
    let url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportExceptional=only');

    pushMock.mockClear();
    fireEvent.change(screen.getByLabelText('Exceptional discount'), { target: { value: 'all' } });
    url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('reportExceptional');
  });

  it('navigates to /sales with a #report anchor, never off the sales page', () => {
    render(<SalesReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'customer' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/sales?')).toBe(true);
    expect(url.endsWith('#report')).toBe(true);
  });
});
