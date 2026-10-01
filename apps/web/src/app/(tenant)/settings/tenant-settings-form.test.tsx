import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { TenantSettingsForm } from './tenant-settings-form';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const TENANT = { id: 't1', name: 'Acme Corp', slug: 'acme', status: 'active', isDemo: false, createdAt: '2026-01-01T00:00:00Z' };

describe('TenantSettingsForm (company name)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('keeps Save disabled until the name changes, then PATCHes only { name }', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<TenantSettingsForm tenant={TENANT} />);
    const save = screen.getByRole('button', { name: /^guardar$/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/nombre de la empresa/i), { target: { value: 'Acme Corp 2' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/tenant', { method: 'PATCH', body: { name: 'Acme Corp 2' } });
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(Object.keys((opts as { body: object }).body)).toEqual(['name']);
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<TenantSettingsForm tenant={TENANT} />);
    fireEvent.change(screen.getByLabelText(/nombre de la empresa/i), { target: { value: 'X Corp' } });
    const save = screen.getByRole('button', { name: /^guardar$/i });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mockedFetch.mock.calls).toHaveLength(1);
    resolve(undefined);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('shows a safe error and does not refresh on API failure', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'stack trace', undefined));
    render(<TenantSettingsForm tenant={TENANT} />);
    fireEvent.change(screen.getByLabelText(/nombre de la empresa/i), { target: { value: 'X Corp' } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));
    expect(await screen.findByText(/algo salió mal/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
