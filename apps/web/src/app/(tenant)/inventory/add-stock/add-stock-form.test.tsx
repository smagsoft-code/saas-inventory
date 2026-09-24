import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { AddStockForm } from './add-stock-form';

vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const PRODUCTS = [{ id: 'p1', name: 'Silla de Comedor' }];
const WAREHOUSES = [
  { id: 'w1', name: 'Sucursal Principal' },
  { id: 'w2', name: 'Sucursal Norte' },
];
const LOCATIONS = [
  { id: 'l1', warehouseId: 'w1', name: 'Almacén Principal' },
  { id: 'l2', warehouseId: 'w1', name: 'Cuarentena' },
  { id: 'l3', warehouseId: 'w2', name: 'General' },
];

function renderForm(overrides: Partial<React.ComponentProps<typeof AddStockForm>> = {}) {
  return render(
    <AddStockForm products={PRODUCTS} warehouses={WAREHOUSES} locations={LOCATIONS} {...overrides} />,
  );
}

async function fillMinimal() {
  fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p1' } });
  await screen.findByRole('option', { name: 'SILLA-1' });
  fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'v1' } });
  fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
  fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'l1' } });
  fireEvent.change(screen.getByLabelText('Cantidad a ingresar'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('Costo unitario'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Motivo del ingreso'), { target: { value: 'Producción propia' } });
}

describe('AddStockForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('only offers locations belonging to the chosen sucursal (cascading selector)', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
    expect(screen.getByRole('option', { name: 'Almacén Principal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cuarentena' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'General' })).not.toBeInTheDocument();
  });

  it('resets the chosen almacén when the sucursal changes', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'l1' } });
    fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w2' } });
    expect(screen.getByLabelText('Almacén')).toHaveValue('');
  });

  it('shows a review step before sending anything to the API, with the movement framed as an entry', async () => {
    mockedFetch.mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }]);
    renderForm();
    await fillMinimal();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));

    expect(await screen.findByText('Revisar ingreso de stock')).toBeInTheDocument();
    expect(screen.getByText('+20')).toBeInTheDocument();
    expect(screen.getByText('Producción propia')).toBeInTheDocument();
    // Nothing sent yet — only the variants GET so far, never the adjustments POST.
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/inventory/adjustments', expect.anything());
  });

  it('POSTs movementType RECEIPT only after confirming the review, never exposing the type to the user', async () => {
    mockedFetch
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }]) // variants
      .mockResolvedValueOnce({ id: 'm1', productVariantId: 'v1', locationId: 'l1', movementType: 'RECEIPT', quantity: 20, balanceAfter: 20 }); // adjustment
    renderForm();
    await fillMinimal();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));
    await screen.findByText('Revisar ingreso de stock');

    expect(screen.queryByText(/tipo/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso' }));

    await waitFor(() => expect(screen.getByText(/ingreso registrado/i)).toBeInTheDocument());
    const [path, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(path).toBe('/api/v1/inventory/adjustments');
    expect((opts as { body: Record<string, unknown> }).body).toEqual({
      productVariantId: 'v1',
      locationId: 'l1',
      movementType: 'RECEIPT',
      quantity: 20,
      unitCost: 5,
      reason: 'Producción propia',
    });
    expect(screen.getByText('20')).toBeInTheDocument(); // balanceAfter
  });

  it('requires a positive quantity, a unit cost, and a 1–500 char reason before allowing review', async () => {
    mockedFetch.mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p1' } });
    await screen.findByRole('option', { name: 'SILLA-1' });
    fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));

    expect(await screen.findByText(/cantidad mayor que cero/i)).toBeInTheDocument();
    expect(screen.getByText(/costo unitario \(0 o mayor\)/i)).toBeInTheDocument();
    expect(screen.getByText(/motivo de 1–500/i)).toBeInTheDocument();
    expect(screen.queryByText('Revisar ingreso de stock')).not.toBeInTheDocument();
  });

  it('shows a fixed, read-only variant and skips the product/variant pickers when preselected', () => {
    renderForm({ fixedProductVariantId: 'v9', fixedVariantLabel: 'PRESET-SKU' });
    expect(screen.queryByLabelText('Producto')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Variante')).toHaveValue('PRESET-SKU');
    expect(screen.getByLabelText('Variante')).toHaveAttribute('readonly');
  });

  it('surfaces a safe 403 message and returns to the form instead of showing a raw backend error', async () => {
    mockedFetch
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'no', undefined));
    renderForm();
    await fillMinimal();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));
    await screen.findByText('Revisar ingreso de stock');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso' }));

    expect(await screen.findByText(/no tienes autorización para agregar stock/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar ingreso' })).toBeInTheDocument();
  });

  it('lets the caller start a fresh entry after a successful one', async () => {
    mockedFetch
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ id: 'm1', productVariantId: 'v1', locationId: 'l1', movementType: 'RECEIPT', quantity: 20, balanceAfter: 20 });
    renderForm();
    await fillMinimal();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));
    await screen.findByText('Revisar ingreso de stock');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso' }));
    await screen.findByText(/ingreso registrado/i);

    fireEvent.click(screen.getByRole('button', { name: 'Registrar otro ingreso' }));
    expect(screen.getByLabelText('Producto')).toHaveValue('');
    expect(screen.getByLabelText('Cantidad a ingresar')).toHaveValue(null);
    expect(screen.getByLabelText('Costo unitario')).toHaveValue(null);
  });
});
