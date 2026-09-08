import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MovementsReportFilters } from './movements-report-filters';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const initial = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  groupBy: 'day' as const,
  movementType: undefined,
};

describe('MovementsReportFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders the initial from/to/groupBy/movementType values', () => {
    render(<MovementsReportFilters initial={initial} />);
    expect(screen.getByLabelText('From')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-08-31');
    expect(screen.getByLabelText('Group by')).toHaveValue('day');
    expect(screen.getByLabelText('Movement type')).toHaveValue('');
  });

  it('navigates with reportGroupBy on a groupBy change, preserving the dates, anchored at #report', () => {
    render(<MovementsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'type' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/inventory/movements?')).toBe(true);
    expect(url).toContain('reportGroupBy=type');
    expect(url).toContain('reportFrom=2026-08-01T00%3A00%3A00.000Z');
    expect(url.endsWith('#report')).toBe(true);
  });

  it('adds reportMovementType only when a type is chosen', () => {
    render(<MovementsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('Movement type'), { target: { value: 'RECEIPT' } });
    let url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportMovementType=RECEIPT');

    pushMock.mockClear();
    fireEvent.change(screen.getByLabelText('Movement type'), { target: { value: '' } });
    url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('reportMovementType');
  });

  it('sends `to` as the start of the NEXT day so the picked end date is fully included ([from, to))', () => {
    render(<MovementsReportFilters initial={initial} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(`reportTo=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`);
  });
});
