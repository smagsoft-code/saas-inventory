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
    for (const day of ['Domingo', 'Lunes', 'Sábado']) {
      expect(screen.getByLabelText(day)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /guardar horario comercial/i })).toBeDisabled();
  });

  it('sends only the enabled days, as the whole-array replace the backend expects', async () => {
    mockedFetch.mockResolvedValueOnce({ timezone: 'UTC', businessHours: [{ dayOfWeek: 1, isClosed: false, opensAt: '09:00', closesAt: '18:00' }], updatedAt: 'x' });
    render(<BusinessHoursForm businessHours={[]} canManage />);

    fireEvent.click(screen.getByLabelText('Lunes'));
    fireEvent.click(screen.getByRole('button', { name: /guardar horario comercial/i }));

    await waitFor(() => expect(screen.getByText(/guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith(PATH, {
      method: 'PATCH',
      body: { businessHours: [{ dayOfWeek: 1, isClosed: false, opensAt: '09:00', closesAt: '18:00' }] },
    });
  });

  it('blocks a save where opening is not before closing (client mirror of the server rule)', async () => {
    render(<BusinessHoursForm businessHours={[]} canManage />);
    fireEvent.click(screen.getByLabelText('Martes'));
    fireEvent.change(screen.getByLabelText(/hora de apertura del martes/i), { target: { value: '19:00' } });
    fireEvent.change(screen.getByLabelText(/hora de cierre del martes/i), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar horario comercial/i }));

    expect(await screen.findByText(/hora de apertura debe ser anterior a la de cierre/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('supports marking a day closed', async () => {
    mockedFetch.mockResolvedValueOnce({ timezone: 'UTC', businessHours: [{ dayOfWeek: 0, isClosed: true }], updatedAt: 'x' });
    render(<BusinessHoursForm businessHours={[]} canManage />);
    fireEvent.click(screen.getByLabelText('Domingo'));
    fireEvent.click(screen.getByLabelText(/cerrado/i));
    fireEvent.click(screen.getByRole('button', { name: /guardar horario comercial/i }));

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
    expect(screen.getByText(/Lunes: 08:00–17:00/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/no tienes permiso/i)).toBeInTheDocument();
  });
});
