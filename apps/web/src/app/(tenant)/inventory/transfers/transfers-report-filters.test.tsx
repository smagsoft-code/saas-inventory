import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransfersReportFilters } from './transfers-report-filters';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe('TransfersReportFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders the initial groupBy value', () => {
    render(<TransfersReportFilters initial={{ groupBy: 'destination' }} />);
    expect(screen.getByLabelText('Group by')).toHaveValue('destination');
  });

  it('navigates with reportGroupBy on change, anchored at #report', () => {
    render(<TransfersReportFilters initial={{ groupBy: 'status' }} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'variant' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toBe('/inventory/transfers?reportGroupBy=variant#report');
  });

  it('offers exactly the three real groupings', () => {
    render(<TransfersReportFilters initial={{ groupBy: 'status' }} />);
    const options = Array.from(screen.getByLabelText('Group by').querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).toEqual(['status', 'destination', 'variant']);
  });
});
