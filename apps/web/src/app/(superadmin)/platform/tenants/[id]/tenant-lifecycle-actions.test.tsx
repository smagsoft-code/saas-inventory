import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../lib/api/errors';
import { apiFetch } from '../../../../../lib/api/client';
import { TenantLifecycleActions } from './tenant-lifecycle-actions';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

describe('TenantLifecycleActions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('suspend: requires a confirm step, then POSTs the real endpoint and refreshes', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<TenantLifecycleActions tenantId="t1" tenantName="Acme" action="suspend" />);

    fireEvent.click(screen.getByRole('button', { name: /suspend company/i }));
    expect(mockedFetch).not.toHaveBeenCalled(); // confirm not yet given

    fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants/t1/suspend', { method: 'POST' });
  });

  it('activate: single button, POSTs the activate endpoint (no destructive confirm)', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<TenantLifecycleActions tenantId="t9" tenantName="Beta" action="activate" />);

    expect(screen.queryByText(/confirm/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /activate company/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants/t9/activate', { method: 'POST' }),
    );
  });

  it('never sends a tenantId in a body/query — only the path segment, method POST only', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<TenantLifecycleActions tenantId="t1" tenantName="Acme" action="activate" />);
    fireEvent.click(screen.getByRole('button', { name: /activate company/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    const [, options] = mockedFetch.mock.calls[0]!;
    expect(options).toEqual({ method: 'POST' });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/body|tenant_?id/i);
  });

  it('shows a safe message on 403 and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    render(<TenantLifecycleActions tenantId="t1" tenantName="Acme" action="activate" />);
    fireEvent.click(screen.getByRole('button', { name: /activate company/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not authorized/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('never echoes a 5xx body', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'at Object.<anonymous> stack', undefined));
    render(<TenantLifecycleActions tenantId="t1" tenantName="Acme" action="suspend" />);
    fireEvent.click(screen.getByRole('button', { name: /suspend company/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/stack/i);
    expect(alert).toHaveTextContent(/something went wrong/i);
  });

  it('does not touch browser storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<TenantLifecycleActions tenantId="t1" tenantName="Acme" action="suspend" />);
    fireEvent.click(screen.getByRole('button', { name: /suspend company/i }));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
