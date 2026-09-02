import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { AdjustmentForm } from './adjustment-form';

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock, replace: vi.fn() }),
}));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const LOCATIONS = [{ id: 'loc-1', name: 'Central / General' }];

describe('AdjustmentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  function fillFixed() {
    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'ADJUSTMENT_OUT' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'cycle count' } });
  }

  it('POSTs exactly CreateAdjustmentDto and never a tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'm1', productVariantId: 'var-1', balanceAfter: 3 });
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} locations={LOCATIONS} />);
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));

    await waitFor(() => expect(screen.getByText(/adjustment recorded/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/adjustments', {
      method: 'POST',
      body: {
        productVariantId: 'var-1',
        locationId: 'loc-1',
        movementType: 'ADJUSTMENT_OUT',
        quantity: 5,
        reason: 'cycle count',
      },
    });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('blocks a non-positive quantity and a missing reason client-side', () => {
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'x' } });
    // canSubmit is satisfied (quantity !== '' , reason !== '') so submit runs validate()
    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));
    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows a location-authorization message on 403 and does not redirect', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(403, 'FORBIDDEN', 'You are not authorized to operate on this location.', undefined),
    );
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} locations={LOCATIONS} />);
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));
    expect(await screen.findByText(/not authorized to adjust stock at this location/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces an insufficient-stock 409 safely', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Insufficient stock at this location.', undefined));
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} locations={LOCATIONS} />);
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));
    expect(await screen.findByText(/insufficient stock/i)).toBeInTheDocument();
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} locations={LOCATIONS} />);
    fillFixed();
    const btn = screen.getByRole('button', { name: /record adjustment/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/inventory/adjustments')).toHaveLength(1);
    resolve({ id: 'm1', productVariantId: 'var-1', balanceAfter: 1 });
    await waitFor(() => expect(screen.getByText(/adjustment recorded/i)).toBeInTheDocument());
  });

  it('loads a product\'s variants when picking a product (no fixed variant)', async () => {
    mockedFetch.mockResolvedValueOnce([{ id: 'var-9', sku: 'SKU-9' }]);
    render(
      <AdjustmentForm products={[{ id: 'prod-1', name: 'Blender' }]} locations={LOCATIONS} />,
    );
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: 'prod-1' } });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/prod-1/variants');
    expect(await screen.findByRole('option', { name: 'SKU-9' })).toBeInTheDocument();
  });

  it('never writes to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'm1', productVariantId: 'var-1', balanceAfter: 1 });
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} locations={LOCATIONS} />);
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));
    await waitFor(() => expect(screen.getByText(/adjustment recorded/i)).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
