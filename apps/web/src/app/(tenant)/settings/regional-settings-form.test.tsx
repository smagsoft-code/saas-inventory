import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { RegionalSettingsForm } from './regional-settings-form';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const PATH = '/api/v1/administration/tenant-settings';

function selectTimezone(value: string): void {
  fireEvent.change(screen.getByLabelText(/zona horaria/i), { target: { value } });
}

describe('RegionalSettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('shows the current timezone and a hint when running on defaults', () => {
    render(<RegionalSettingsForm timezone="UTC" usingDefaults canManage />);
    expect((screen.getByLabelText(/zona horaria/i) as HTMLSelectElement).value).toBe('UTC');
    expect(screen.getByText(/valor predeterminado del sistema/i)).toBeInTheDocument();
  });

  it('offers the full IANA set the backend accepts', () => {
    render(<RegionalSettingsForm timezone="America/Bogota" usingDefaults={false} canManage />);
    const options = Array.from((screen.getByLabelText(/zona horaria/i) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(Intl.supportedValuesOf('timeZone'));
  });

  it('keeps the saved value visible even when the runtime does not list it', () => {
    render(<RegionalSettingsForm timezone="UTC" usingDefaults canManage />);
    const options = Array.from((screen.getByLabelText(/zona horaria/i) as HTMLSelectElement).options).map((o) => o.value);
    expect(options[0]).toBe('UTC');
    expect((screen.getByLabelText(/zona horaria/i) as HTMLSelectElement).value).toBe('UTC');
  });

  it('keeps Save disabled until the value changes, then PATCHes only { timezone }', async () => {
    mockedFetch.mockResolvedValueOnce({ timezone: 'America/Bogota', businessHours: [], updatedAt: '2026-01-01T00:00:00Z' });
    render(<RegionalSettingsForm timezone="America/Lima" usingDefaults={false} canManage />);

    const save = screen.getByRole('button', { name: /guardar zona horaria/i });
    expect(save).toBeDisabled();

    selectTimezone('America/Bogota');
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/zona horaria guardada/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith(PATH, { method: 'PATCH', body: { timezone: 'America/Bogota' } });
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(Object.keys((opts as { body: object }).body)).toEqual(['timezone']);
    expect(refreshMock).toHaveBeenCalled();
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<RegionalSettingsForm timezone="UTC" usingDefaults canManage />);
    selectTimezone('America/Bogota');
    const save = screen.getByRole('button', { name: /guardar zona horaria/i });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mockedFetch.mock.calls.filter(([p]) => p === PATH)).toHaveLength(1);
    resolve({ timezone: 'America/Bogota', businessHours: [], updatedAt: 'x' });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('shows a safe error message on API failure and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'stack trace here', undefined));
    render(<RegionalSettingsForm timezone="UTC" usingDefaults canManage />);
    selectTimezone('America/Bogota');
    fireEvent.click(screen.getByRole('button', { name: /guardar zona horaria/i }));

    const alert = await screen.findByText(/algo salió mal/i);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText(/stack trace/i)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('surfaces a 403 as a permission message', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden', undefined));
    render(<RegionalSettingsForm timezone="UTC" usingDefaults canManage />);
    selectTimezone('America/Bogota');
    fireEvent.click(screen.getByRole('button', { name: /guardar zona horaria/i }));
    expect(await screen.findByText(/permiso/i)).toBeInTheDocument();
  });

  it('renders read-only (no form, no select) when the caller cannot manage settings', () => {
    render(<RegionalSettingsForm timezone="America/Lima" usingDefaults={false} canManage={false} />);
    expect(screen.getByText('America/Lima')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/zona horaria/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no tienes permiso/i)).toBeInTheDocument();
  });

  it('never writes settings to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ timezone: 'America/Bogota', businessHours: [], updatedAt: 'x' });
    render(<RegionalSettingsForm timezone="UTC" usingDefaults canManage />);
    selectTimezone('America/Bogota');
    fireEvent.click(screen.getByRole('button', { name: /guardar zona horaria/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/timezone|bogota/i);
  });
});
