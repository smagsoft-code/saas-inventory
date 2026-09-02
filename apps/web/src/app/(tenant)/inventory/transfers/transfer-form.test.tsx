import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { TransferForm } from './transfer-form';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn() }),
}));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const LOCATIONS = [
  { id: 'loc-1', name: 'Central / General' },
  { id: 'loc-2', name: 'Store / Floor' },
];
const PRODUCTS = [{ id: 'prod-1', name: 'Blender' }];

async function fillOneLine() {
  fireEvent.change(screen.getByLabelText(/from location/i), { target: { value: 'loc-1' } });
  fireEvent.change(screen.getByLabelText(/to location/i), { target: { value: 'loc-2' } });
  mockedFetch.mockResolvedValueOnce([{ id: 'var-9', sku: 'SKU-9' }]);
  fireEvent.change(screen.getByLabelText(/product/i), { target: { value: 'prod-1' } });
  await screen.findByRole('option', { name: 'SKU-9' });
  fireEvent.change(screen.getByLabelText(/variant/i), { target: { value: 'var-9' } });
  fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '4' } });
}

describe('TransferForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('POSTs exactly CreateTransferDto and never a tenantId', async () => {
    render(<TransferForm products={PRODUCTS} locations={LOCATIONS} />);
    await fillOneLine();
    mockedFetch.mockResolvedValueOnce({ id: 't-1' });
    fireEvent.click(screen.getByRole('button', { name: /create transfer/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/inventory/transfers/t-1'));
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/inventory/transfers', {
      method: 'POST',
      body: {
        sourceLocationId: 'loc-1',
        destinationLocationId: 'loc-2',
        items: [{ productVariantId: 'var-9', quantityRequested: 4 }],
      },
    });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('blocks source === destination client-side', async () => {
    render(<TransferForm products={PRODUCTS} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText(/from location/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/to location/i), { target: { value: 'loc-1' } });

    expect(screen.getByText(/must be different/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create transfer/i }));
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/inventory/transfers')).toHaveLength(0);
  });

  it('loads variants via GET /products/:id/variants (no tenant-wide list)', async () => {
    render(<TransferForm products={PRODUCTS} locations={LOCATIONS} />);
    mockedFetch.mockResolvedValueOnce([{ id: 'var-9', sku: 'SKU-9' }]);
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: 'prod-1' } });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/prod-1/variants');
    expect(await screen.findByRole('option', { name: 'SKU-9' })).toBeInTheDocument();
  });

  it('shows a location-authorization message on 403 and does not redirect', async () => {
    render(<TransferForm products={PRODUCTS} locations={LOCATIONS} />);
    await fillOneLine();
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    fireEvent.click(screen.getByRole('button', { name: /create transfer/i }));
    expect(await screen.findByText(/not authorized to create a transfer/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces a 409 safely', async () => {
    render(<TransferForm products={PRODUCTS} locations={LOCATIONS} />);
    await fillOneLine();
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Source and destination locations must be different.', undefined));
    fireEvent.click(screen.getByRole('button', { name: /create transfer/i }));
    expect(await screen.findByText(/source and destination locations must be different/i)).toBeInTheDocument();
  });

  it('does not fire a second request on a double submit', async () => {
    render(<TransferForm products={PRODUCTS} locations={LOCATIONS} />);
    await fillOneLine();
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const btn = screen.getByRole('button', { name: /create transfer/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/inventory/transfers')).toHaveLength(1);
    resolve({ id: 't-1' });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('never writes to browser storage', async () => {
    render(<TransferForm products={PRODUCTS} locations={LOCATIONS} />);
    await fillOneLine();
    mockedFetch.mockResolvedValueOnce({ id: 't-1' });
    fireEvent.click(screen.getByRole('button', { name: /create transfer/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
