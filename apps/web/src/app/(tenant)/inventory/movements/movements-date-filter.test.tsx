import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MovementsDateFilter } from './movements-date-filter';

const pushMock = vi.fn();
let currentSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/inventory/movements',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

describe('MovementsDateFilter', () => {
  beforeEach(() => {
    pushMock.mockClear();
    currentSearch = '';
  });

  it('renders the initial from/to values', () => {
    render(<MovementsDateFilter initial={{ occurredFrom: '2026-06-01T00:00:00.000Z', occurredTo: '2026-06-15T00:00:00.000Z' }} />);
    expect(screen.getByLabelText('From')).toHaveValue('2026-06-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-06-15');
  });

  it('sends occurredFrom as the picked date at 00:00:00.000Z', () => {
    render(<MovementsDateFilter initial={{}} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } });
    expect(pushMock).toHaveBeenCalledWith('/inventory/movements?occurredFrom=2026-07-01T00%3A00%3A00.000Z');
  });

  it('sends occurredTo as the START of the NEXT day, so the picked end date is fully included ([occurredFrom, occurredTo))', () => {
    render(<MovementsDateFilter initial={{}} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(encodeURIComponent('2026-07-06T00:00:00.000Z'));
  });

  it('carries other existing filters forward and resets page, never dropping locationId/movementType', () => {
    currentSearch = 'locationId=loc-1&movementType=RECEIPT&page=3';
    render(<MovementsDateFilter initial={{}} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('locationId=loc-1');
    expect(url).toContain('movementType=RECEIPT');
    expect(url).not.toContain('page=3');
  });

  it('clears occurredFrom from the URL when the field is cleared', () => {
    currentSearch = 'occurredFrom=2026-06-01T00%3A00%3A00.000Z';
    render(<MovementsDateFilter initial={{ occurredFrom: '2026-06-01T00:00:00.000Z' }} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('occurredFrom');
  });
});
