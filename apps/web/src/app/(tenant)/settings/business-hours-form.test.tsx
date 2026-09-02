import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import { BusinessHoursForm } from './business-hours-form';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const PATH = '/api/v1/administration/tenant-settings';

describe('BusinessHoursForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders one row per weekday and keeps Save disabled until something changes', () => {
    render(<BusinessHoursForm businessHours={[]} canManage />);
    for (const day of ['Sunday', 'Monday', 'Saturday']) {
      expect(screen.getByLabelText(day)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /save business hours/i })).toBeDisabled();
  });

  it('sends only the enabled days, as the whole-array replace the backend expects', async () => {
    mockedFetch.mockResolvedValueOnce({ timezone: 'UTC', businessHours: [{ dayOfWeek: 1, isClosed: false, opensAt: '09:00', closesAt: '18:00' }], updatedAt: 'x' });
    render(<BusinessHoursForm businessHours={[]} canManage />);

    fireEvent.click(screen.getByLabelText('Monday'));
    fireEvent.click(screen.getByRole('button', { name: /save business hours/i }));

    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith(PATH, {
      method: 'PATCH',
      body: { businessHours: [{ dayOfWeek: 1, isClosed: false, opensAt: '09:00', closesAt: '18:00' }] },
    });
  });

  it('blocks a save where opening is not before closing (client mirror of the server rule)', async () => {
    render(<BusinessHoursForm businessHours={[]} canManage />);
    fireEvent.click(screen.getByLabelText('Tuesday'));
    fireEvent.change(screen.getByLabelText(/tuesday opening time/i), { target: { value: '19:00' } });
    fireEvent.change(screen.getByLabelText(/tuesday closing time/i), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save business hours/i }));

    expect(await screen.findByText(/opening time must be before closing time/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('supports marking a day closed', async () => {
    mockedFetch.mockResolvedValueOnce({ timezone: 'UTC', businessHours: [{ dayOfWeek: 0, isClosed: true }], updatedAt: 'x' });
    render(<BusinessHoursForm businessHours={[]} canManage />);
    fireEvent.click(screen.getByLabelText('Sunday'));
    fireEvent.click(screen.getByLabelText(/closed/i));
    fireEvent.click(screen.getByRole('button', { name: /save business hours/i }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(PATH, {
        method: 'PATCH',
        body: { businessHours: [{ dayOfWeek: 0, isClosed: true }] },
      }),
    );
  });

  it('renders read-only when the caller cannot manage settings', () => {
    render(
      <BusinessHoursForm
        businessHours={[{ dayOfWeek: 1, isClosed: false, opensAt: '08:00', closesAt: '17:00' }]}
        canManage={false}
      />,
    );
    expect(screen.getByText(/Monday: 08:00–17:00/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
  });
});
