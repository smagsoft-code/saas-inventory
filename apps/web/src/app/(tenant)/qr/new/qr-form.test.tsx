import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { QrForm } from './qr-form';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const products = [{ id: 'p1', name: 'Fridge' }];
const warehouses = [{ id: 'w1', name: 'Sucursal Central' }];
const locations = [{ id: 'l1', warehouseId: 'w1', name: 'Main floor' }];

function renderForm(
  overrides: {
    variantIdsWithActiveQr?: Set<string>;
    locationIdsWithActiveQr?: Set<string>;
    initialProductId?: string;
    initialVariantId?: string;
  } = {},
) {
  return render(
    <QrForm
      products={products}
      warehouses={warehouses}
      locations={locations}
      variantIdsWithActiveQr={overrides.variantIdsWithActiveQr ?? new Set()}
      locationIdsWithActiveQr={overrides.locationIdsWithActiveQr ?? new Set()}
      {...(overrides.initialProductId ? { initialProductId: overrides.initialProductId } : {})}
      {...(overrides.initialVariantId ? { initialVariantId: overrides.initialVariantId } : {})}
      publicUrl="http://localhost:4000"
    />,
  );
}

/** Selects the location target type and drills into its sucursal → almacén cascade. */
function pickLocation(locationId: string) {
  fireEvent.change(screen.getByLabelText('Tipo de destino'), { target: { value: 'location' } });
  fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
  fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: locationId } });
}

describe('QrForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('defaults to product_variant and loads variants for the chosen product', async () => {
    mockedFetch.mockResolvedValueOnce([{ id: 'v1', sku: 'FRIDGE-A', maxPrice: 199.99 }]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p1' } });
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants'),
    );
    await screen.findByRole('option', { name: 'FRIDGE-A' });
  });

  it('submits exactly { targetType, targetId } for a variant target — no tenantId — and shows the generated QR inline (never a redirect)', async () => {
    mockedFetch
      .mockResolvedValueOnce([{ id: 'v1', sku: 'FRIDGE-A', maxPrice: 199.99 }]) // variant load
      .mockResolvedValueOnce({ id: 'q1', code: 'abc123', targetType: 'product_variant', targetId: 'v1' }); // create
    renderForm();
    fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p1' } });
    await screen.findByRole('option', { name: 'FRIDGE-A' });
    fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/qr-codes', {
      method: 'POST',
      body: { targetType: 'product_variant', targetId: 'v1' },
    });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenant_?id/i);

    // Same enlarged view a click on the /products QR thumbnail opens — open by default, with the
    // real code and price — rather than a silent redirect to /qr.
    const dialog = await screen.findByRole('dialog', { name: /código qr — fridge — fridge-a/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('http://localhost:4000/q/abc123')).toBeInTheDocument();
    expect(screen.getByText('Precio máximo: 199.99')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('lets the caller generate another after success, resetting the form', async () => {
    mockedFetch
      .mockResolvedValueOnce([{ id: 'v1', sku: 'FRIDGE-A', maxPrice: 199.99 }])
      .mockResolvedValueOnce({ id: 'q1', code: 'abc123', targetType: 'product_variant', targetId: 'v1' });
    renderForm();
    fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p1' } });
    await screen.findByRole('option', { name: 'FRIDGE-A' });
    fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Generar otro' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Producto')).toHaveValue('');
  });

  it('switches to a location target, cascading sucursal → almacén, and submits the location id', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'q2', code: 'loc-code', targetType: 'location', targetId: 'l1' });
    renderForm();
    fireEvent.change(screen.getByLabelText('Tipo de destino'), { target: { value: 'location' } });
    expect(screen.getByLabelText('Almacén')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
    expect(screen.getByLabelText('Almacén')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes', {
        method: 'POST',
        body: { targetType: 'location', targetId: 'l1' },
      }),
    );
    // A location QR has no price — the success view never claims one.
    await screen.findByRole('dialog');
    expect(screen.queryByText(/precio máximo/i)).not.toBeInTheDocument();
  });

  it('pre-selects the product/variant given via initialProductId/initialVariantId (the /products "Generar" link)', async () => {
    mockedFetch.mockResolvedValueOnce([
      { id: 'v1', sku: 'FRIDGE-A', maxPrice: 199.99 },
      { id: 'v2', sku: 'FRIDGE-B', maxPrice: 249.99 },
    ]);
    renderForm({ initialProductId: 'p1', initialVariantId: 'v2' });
    await waitFor(() => expect(screen.getByLabelText('Producto')).toHaveValue('p1'));
    await waitFor(() => expect(screen.getByLabelText('Variante')).toHaveValue('v2'));
  });

  it('includes expiresAt as an ISO date-time only when a date is entered', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'q3', targetType: 'location' });
    renderForm();
    pickLocation('l1');
    fireEvent.change(screen.getByLabelText('Vence el'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    const [, options] = mockedFetch.mock.calls.at(-1)!;
    expect((options as { body: { expiresAt: string } }).body.expiresAt).toBe('2026-12-31T23:59:59.999Z');
  });

  it('blocks submit until a target is chosen', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled();
  });

  it('shows a safe error on 403 and does not navigate', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'no', undefined));
    renderForm();
    pickLocation('l1');
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no tienes autorización/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a clear Spanish error on 409 (target already has an active QR) and does not navigate', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'This target already has an active QR code.', undefined));
    renderForm();
    pickLocation('l1');
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya tiene un código qr activo/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('disables a variant option that already has an active QR (OUI-010), and never submits it', async () => {
    mockedFetch.mockResolvedValueOnce([
      { id: 'v1', sku: 'FRIDGE-A' },
      { id: 'v2', sku: 'FRIDGE-B' },
    ]);
    renderForm({ variantIdsWithActiveQr: new Set(['v1']) });
    fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p1' } });
    await screen.findByRole('option', { name: /FRIDGE-A/ });

    expect(screen.getByRole('option', { name: /FRIDGE-A \(ya tiene qr activo\)/i })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'FRIDGE-B' })).toBeEnabled();

    // A disabled <option> can't be chosen through the UI, but the guard still runs defensively.
    fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(screen.getByText(/ya tiene un código qr activo/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/qr-codes', expect.anything());
  });

  it('disables a location option that already has an active QR', () => {
    renderForm({ locationIdsWithActiveQr: new Set(['l1']) });
    fireEvent.change(screen.getByLabelText('Tipo de destino'), { target: { value: 'location' } });
    fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w1' } });
    expect(screen.getByRole('option', { name: /main floor \(ya tiene qr activo\)/i })).toBeDisabled();
  });
});
