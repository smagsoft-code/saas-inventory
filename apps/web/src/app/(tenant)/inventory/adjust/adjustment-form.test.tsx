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

const WAREHOUSES = [
  { id: 'wh-1', name: 'Sucursal Central' },
  { id: 'wh-2', name: 'Sucursal Norte' },
];
const LOCATIONS = [
  { id: 'loc-1', warehouseId: 'wh-1', name: 'Central / General' },
  { id: 'loc-2', warehouseId: 'wh-2', name: 'Norte / General' },
];

describe('AdjustmentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  function fillFixed() {
    fireEvent.change(screen.getByLabelText(/sucursal/i), { target: { value: 'wh-1' } });
    fireEvent.change(screen.getByLabelText(/almacén/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/^tipo/i), { target: { value: 'ADJUSTMENT_OUT' } });
    fireEvent.change(screen.getByLabelText(/cantidad/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'cycle count' } });
  }

  it('POSTs exactly CreateAdjustmentDto (plus occurredAt) and never a tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'm1', productVariantId: 'var-1', balanceAfter: 3 });
    render(
      <AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />,
    );
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /registrar ajuste/i }));

    await waitFor(() => expect(screen.getByText(/ajuste registrado/i)).toBeInTheDocument());
    const [path, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(path).toBe('/api/v1/inventory/adjustments');
    const body = (opts as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({
      productVariantId: 'var-1',
      locationId: 'loc-1',
      movementType: 'ADJUSTMENT_OUT',
      quantity: 5,
      reason: 'cycle count',
    });
    // occurredAt defaults to "now" without the user touching it — assert it's a real, current ISO
    // timestamp rather than a hardcoded value (avoids baking in a timezone assumption). The
    // datetime-local input only has minute precision, so allow up to a minute of drift.
    expect(typeof body['occurredAt']).toBe('string');
    expect(Math.abs(new Date(body['occurredAt'] as string).getTime() - Date.now())).toBeLessThan(65000);
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('only offers locations belonging to the chosen sucursal, and resets almacén when it changes', () => {
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText(/sucursal/i), { target: { value: 'wh-1' } });
    expect(screen.getByRole('option', { name: 'Central / General' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Norte / General' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/almacén/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/sucursal/i), { target: { value: 'wh-2' } });
    expect(screen.getByLabelText(/almacén/i)).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Norte / General' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Central / General' })).not.toBeInTheDocument();
  });

  it('preselects the sucursal matching a fixed (drill-in) location', () => {
    render(
      <AdjustmentForm
        fixedProductVariantId="var-1"
        fixedLocationId="loc-2"
        products={[]}
        warehouses={WAREHOUSES}
        locations={LOCATIONS}
      />,
    );
    expect(screen.getByLabelText(/sucursal/i)).toHaveValue('wh-2');
    expect(screen.getByLabelText(/almacén/i)).toHaveValue('loc-2');
  });

  it('defaults "Fecha del movimiento" to now, and disables submit (required) if cleared', () => {
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />);
    const dateInput = screen.getByLabelText(/fecha del movimiento/i) as HTMLInputElement;
    expect(dateInput.value).not.toBe('');

    fillFixed();
    expect(screen.getByRole('button', { name: /registrar ajuste/i })).toBeEnabled();
    fireEvent.change(dateInput, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /registrar ajuste/i })).toBeDisabled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('blocks a non-positive quantity and a missing reason client-side', () => {
    render(<AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText(/sucursal/i), { target: { value: 'wh-1' } });
    fireEvent.change(screen.getByLabelText(/almacén/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/cantidad/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'x' } });
    // canSubmit is satisfied (quantity !== '' , reason !== '') so submit runs validate()
    fireEvent.click(screen.getByRole('button', { name: /registrar ajuste/i }));
    expect(screen.getByText(/mayor que cero/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows a location-authorization message on 403 and does not redirect', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(403, 'FORBIDDEN', 'You are not authorized to operate on this location.', undefined),
    );
    render(
      <AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />,
    );
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /registrar ajuste/i }));
    expect(await screen.findByText(/no tienes autorización para ajustar existencias en este almacén/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces an insufficient-stock 409 safely', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Insufficient stock at this location.', undefined));
    render(
      <AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />,
    );
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /registrar ajuste/i }));
    expect(await screen.findByText(/insufficient stock/i)).toBeInTheDocument();
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(
      <AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />,
    );
    fillFixed();
    const btn = screen.getByRole('button', { name: /registrar ajuste/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/inventory/adjustments')).toHaveLength(1);
    resolve({ id: 'm1', productVariantId: 'var-1', balanceAfter: 1 });
    await waitFor(() => expect(screen.getByText(/ajuste registrado/i)).toBeInTheDocument());
  });

  it('shows the SKU label for a fixed variant when given, and the id otherwise', () => {
    const { rerender } = render(
      <AdjustmentForm
        fixedProductVariantId="var-1"
        fixedVariantLabel="SKU-1"
        products={[]}
        warehouses={WAREHOUSES}
        locations={LOCATIONS}
      />,
    );
    expect((screen.getByLabelText(/^variante/i) as HTMLInputElement).value).toBe('SKU-1');
    rerender(
      <AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />,
    );
    expect((screen.getByLabelText(/^variante/i) as HTMLInputElement).value).toBe('var-1');
  });

  it('loads a product\'s variants when picking a product (no fixed variant)', async () => {
    mockedFetch.mockResolvedValueOnce([{ id: 'var-9', sku: 'SKU-9' }]);
    render(
      <AdjustmentForm products={[{ id: 'prod-1', name: 'Blender' }]} warehouses={WAREHOUSES} locations={LOCATIONS} />,
    );
    fireEvent.change(screen.getByLabelText(/producto/i), { target: { value: 'prod-1' } });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/prod-1/variants');
    expect(await screen.findByRole('option', { name: 'SKU-9' })).toBeInTheDocument();
  });

  it('never writes to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'm1', productVariantId: 'var-1', balanceAfter: 1 });
    render(
      <AdjustmentForm fixedProductVariantId="var-1" products={[]} warehouses={WAREHOUSES} locations={LOCATIONS} />,
    );
    fillFixed();
    fireEvent.click(screen.getByRole('button', { name: /registrar ajuste/i }));
    await waitFor(() => expect(screen.getByText(/ajuste registrado/i)).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
