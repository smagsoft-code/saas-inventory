import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { AddStockForm } from './add-stock-form';

vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const WAREHOUSES = [
  { id: 'w1', name: 'Sucursal Principal' },
  { id: 'w2', name: 'Sucursal Norte' },
];
const LOCATIONS = [
  { id: 'l1', warehouseId: 'w1', name: 'Almacén Principal' },
  { id: 'l2', warehouseId: 'w1', name: 'Cuarentena' },
  { id: 'l3', warehouseId: 'w2', name: 'General' },
];
const MOVEMENT = { id: 'm1', productVariantId: 'v1', locationId: 'l1', movementType: 'RECEIPT', quantity: 20, balanceAfter: 20 };

/** Routes by path: product search, variants of the chosen product, and the adjustments POST. */
function routeFetch(opts: { products?: unknown[]; adjustment?: unknown } = {}): void {
  mockedFetch.mockImplementation((async (path: string) => {
    if (path === '/api/v1/products') {
      return {
        data: opts.products ?? [
          { id: 'p1', name: 'Silla de Comedor', status: 'active' },
          { id: 'p2', name: 'Silla vieja', status: 'discontinued' },
          { id: 'p3', name: 'Silla nueva', status: 'draft' },
          { id: 'p4', name: 'Mesa de centro', status: 'active' },
        ],
      };
    }
    if (path === '/api/v1/products/p1/variants') return [{ id: 'v1', sku: 'SILLA-1' }];
    if (path === '/api/v1/products/p4/variants') return [{ id: 'v4a', sku: 'MESA-1' }, { id: 'v4b', sku: 'MESA-2' }];
    if (path === '/api/v1/products/p1/images') return [{ url: '/api/v1/products/p1/images/img-1' }];
    if (path === '/api/v1/qr-codes') return { data: [{ code: 'abc123' }] };
    if (path === '/api/v1/inventory/adjustments') {
      if (opts.adjustment instanceof Error) throw opts.adjustment;
      return opts.adjustment ?? MOVEMENT;
    }
    throw new Error(`unexpected fetch ${path}`);
  }) as never);
}

function renderForm(overrides: Partial<React.ComponentProps<typeof AddStockForm>> = {}) {
  return render(<AddStockForm warehouses={WAREHOUSES} locations={LOCATIONS} {...overrides} />);
}

/** Types in the product search bar and picks the first real result. */
async function pickProduct(name = 'Silla de Comedor'): Promise<void> {
  fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'silla' } });
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  await screen.findByRole('option', { name: 'SILLA-1' });
}

async function fillMinimal() {
  await pickProduct();
  fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'v1' } });
  fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
  fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'l1' } });
  fireEvent.change(screen.getByLabelText('Cantidad a ingresar'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('Costo unitario'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Motivo del ingreso'), { target: { value: 'Producción propia' } });
}

describe('AddStockForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeFetch();
  });
  afterEach(() => cleanup());

  it('uses a search bar for the product (no dropdown) and searches the server with q', async () => {
    renderForm();
    expect(screen.getByLabelText('Buscar producto')).toHaveAttribute('type', 'search');
    expect(mockedFetch).not.toHaveBeenCalled(); // nothing is preloaded
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'silla' } });
    await screen.findByRole('option', { name: /Silla de Comedor/ });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products', { query: { q: 'silla', pageSize: 20 } });
    expect(mockedFetch).toHaveBeenCalledTimes(1); // debounced: one request for the whole word
  });

  it('offers every product except discontinued ones (drafts included, tagged)', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'silla' } });
    await screen.findByRole('option', { name: /Silla de Comedor/ });
    expect(screen.getByRole('option', { name: /Silla nueva/ })).toBeInTheDocument();
    expect(screen.getByText('Borrador')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Silla vieja/ })).not.toBeInTheDocument();
  });

  it('shows an empty-result message', async () => {
    routeFetch({ products: [] });
    renderForm();
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'zzz' } });
    expect(await screen.findByText('Ningún producto coincide con esa búsqueda.')).toBeInTheDocument();
  });

  it('after picking a product it loads that product\'s variants, and "Cambiar" returns to the search bar', async () => {
    renderForm();
    await pickProduct();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants');
    expect(screen.getByText('Silla de Comedor')).toBeInTheDocument();
    expect(screen.queryByLabelText('Buscar producto')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByLabelText('Buscar producto')).toHaveValue('');
    expect(screen.getByLabelText('Variante')).toBeDisabled();
  });

  it('preselects the variant when the product has only one, and leaves the choice open when it has several', async () => {
    renderForm({ canViewQr: true, apiPublicUrl: 'http://api.test' });
    await pickProduct();
    await waitFor(() => expect(screen.getByLabelText('Variante')).toHaveValue('v1'));

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'mesa' } });
    fireEvent.click(await screen.findByRole('option', { name: /Mesa de centro/ }));
    await screen.findByRole('option', { name: 'MESA-2' });
    expect(screen.getByLabelText('Variante')).toHaveValue('');
  });

  it('shows the product photo and the variant QR in a side panel', async () => {
    const { container } = renderForm({ canViewQr: true, apiPublicUrl: 'http://api.test' });
    await pickProduct();
    await waitFor(() => expect(container.querySelector('aside img')).toHaveAttribute('src', '/api/v1/products/p1/images/img-1'));
    expect(await screen.findByText('http://api.test/q/abc123')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes', {
      query: { targetType: 'product_variant', targetId: 'v1', pageSize: 1 },
    });
  });

  it('hides the QR card without the QR permission', async () => {
    renderForm();
    await pickProduct();
    expect(screen.queryByText('Código QR')).not.toBeInTheDocument();
  });

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
    renderForm();
    await fillMinimal();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));

    expect(await screen.findByText('Revisar ingreso de stock')).toBeInTheDocument();
    expect(screen.getByText('+20')).toBeInTheDocument();
    expect(screen.getByText('Producción propia')).toBeInTheDocument();
    expect(screen.getByText('Silla de Comedor')).toBeInTheDocument();
    // Nothing written yet — never the adjustments POST.
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/inventory/adjustments', expect.anything());
  });

  it('POSTs movementType RECEIPT only after confirming the review, never exposing the type to the user', async () => {
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
    renderForm();
    await pickProduct();
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
    expect(screen.queryByLabelText('Buscar producto')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Variante')).toHaveValue('PRESET-SKU');
    expect(screen.getByLabelText('Variante')).toHaveAttribute('readonly');
  });

  it('surfaces a safe 403 message and returns to the form instead of showing a raw backend error', async () => {
    routeFetch({ adjustment: new ApiError(403, 'FORBIDDEN', 'no', undefined) });
    renderForm();
    await fillMinimal();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));
    await screen.findByText('Revisar ingreso de stock');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso' }));

    expect(await screen.findByText(/no tienes autorización para agregar stock/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar ingreso' })).toBeInTheDocument();
  });

  it('lets the caller start a fresh entry after a successful one', async () => {
    renderForm();
    await fillMinimal();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ingreso' }));
    await screen.findByText('Revisar ingreso de stock');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso' }));
    await screen.findByText(/ingreso registrado/i);

    fireEvent.click(screen.getByRole('button', { name: 'Registrar otro ingreso' }));
    expect(screen.getByLabelText('Buscar producto')).toHaveValue('');
    expect(screen.getByLabelText('Cantidad a ingresar')).toHaveValue(null);
    expect(screen.getByLabelText('Costo unitario')).toHaveValue(null);
  });
});
