import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReturnsReportFilters } from './returns-report-filters';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const initial = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z', groupBy: 'day' as const };

describe('ReturnsReportFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders the initial from/to/groupBy values', () => {
    render(<ReturnsReportFilters initial={initial} />);
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-08-31');
    expect(screen.getByLabelText('Agrupar por')).toHaveValue('day');
  });

  it('navigates with reportGroupBy on a groupBy change, preserving the current dates', () => {
    render(<ReturnsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Agrupar por'), { target: { value: 'disposition' } });
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('reportGroupBy=disposition'));
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportFrom=2026-08-01T00%3A00%3A00.000Z');
  });

  it('sends `to` as the start of the NEXT day, so the picked end date is fully included ([from, to))', () => {
    render(<ReturnsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(`reportTo=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`);
  });

  it('navigates to /returns with a #report anchor, never off the returns page', () => {
    render(<ReturnsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Agrupar por'), { target: { value: 'customer' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/returns?')).toBe(true);
    expect(url.endsWith('#report')).toBe(true);
  });
});
