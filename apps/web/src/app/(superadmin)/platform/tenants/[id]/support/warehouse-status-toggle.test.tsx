import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../../lib/api/errors';
import { apiFetch } from '../../../../../../lib/api/client';
import { WarehouseStatusToggle } from './warehouse-status-toggle';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../../../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

describe('WarehouseStatusToggle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('read-only session (writable=false): no button, just a hint', () => {
    render(<WarehouseStatusToggle tenantId="t1" warehouseId="w1" status="active" writable={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/requiere modo intervención/i)).toBeInTheDocument();
  });

  it('active → PATCHes status: inactive and refreshes', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<WarehouseStatusToggle tenantId="t1" warehouseId="w1" status="active" writable />);
    fireEvent.click(screen.getByRole('button', { name: /desactivar/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants/t1/support/warehouses/w1/status', {
      method: 'PATCH',
      body: { status: 'inactive' },
    });
  });

  it('inactive → PATCHes status: active', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<WarehouseStatusToggle tenantId="t1" warehouseId="w1" status="inactive" writable />);
    fireEvent.click(screen.getByRole('button', { name: /^activar$/i }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants/t1/support/warehouses/w1/status', {
        method: 'PATCH',
        body: { status: 'active' },
      }),
    );
  });

  it('shows a safe error on failure and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'session is read-only', undefined));
    render(<WarehouseStatusToggle tenantId="t1" warehouseId="w1" status="active" writable />);
    fireEvent.click(screen.getByRole('button', { name: /desactivar/i }));

    expect(await screen.findByText(/no tienes permiso/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
