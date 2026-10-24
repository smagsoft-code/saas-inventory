import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import type { LocationScope } from '../../../../lib/inventory/location-scope';
import { TransferForm } from './transfer-form';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn() }),
}));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const WAREHOUSES = [
  { id: 'wh-1', name: 'Sucursal Central' },
  { id: 'wh-2', name: 'Sucursal Norte' },
];
const LOCATIONS = [
  { id: 'loc-1', warehouseId: 'wh-1', name: 'Central / General' },
  { id: 'loc-2', warehouseId: 'wh-2', name: 'Store / Floor' },
];
const PRODUCTS = [{ id: 'prod-1', name: 'Blender' }];
const UNRESTRICTED: LocationScope = { unrestricted: true, locationIds: [] };

/** Routes every `apiFetch` call by path/method/query instead of a strict FIFO
 * `mockResolvedValueOnce` queue — the form fires several order-varying calls (products-in-stock,
 * variants, stock disponible, the final create), so a FIFO queue would silently consume the wrong
 * mock for whichever call happens to run first. `productsInStock` defaults to offering `PRODUCTS`
 * at `loc-1` — the origin `fillOneLine()` always picks — so callers only need to override it when
 * a test cares about a different location's eligible list. */
function mockApi(opts: {
  variants?: Record<string, { id: string; sku: string }[]>;
  stock?: number;
  productsInStock?: Record<string, { id: string; name: string }[]>;
  create?: unknown | Error;
}): void {
  const productsInStock = opts.productsInStock ?? { 'loc-1': PRODUCTS };
  mockedFetch.mockImplementation(async (path: string, init?: { method?: string; query?: Record<string, unknown> }) => {
    if (path.startsWith('/api/v1/products/') && path.endsWith('/variants')) {
      const productId = path.split('/')[4];
      return opts.variants?.[productId as string] ?? [];
    }
    if (path === '/api/v1/inventory/products-in-stock') {
      const locationId = init?.query?.['locationId'] as string | undefined;
      return (locationId ? productsInStock[locationId] : undefined) ?? [];
    }
    if (path === '/api/v1/inventory/balances') {
      return { data: [{ quantityAvailable: opts.stock ?? 1000 }] };
    }
    if (path === '/api/v1/inventory/transfers' && init?.method === 'POST') {
      if (opts.create instanceof Error) throw opts.create;
      return opts.create ?? { id: 't-1' };
    }
    throw new Error(`Unexpected apiFetch call: ${path}`);
  });
}

function renderForm(overrides: { sourceWarehouses?: typeof WAREHOUSES; scope?: LocationScope; canViewInventory?: boolean } = {}) {
  return render(
    <TransferForm
      warehouses={WAREHOUSES}
      sourceWarehouses={overrides.sourceWarehouses ?? WAREHOUSES}
      locations={LOCATIONS}
      scope={overrides.scope ?? UNRESTRICTED}
      canViewInventory={overrides.canViewInventory ?? true}
    />,
  );
}

async function chooseOrigin(): Promise<void> {
  fireEvent.change(screen.getByLabelText(/sucursal de origen/i), { target: { value: 'wh-1' } });
  fireEvent.change(screen.getByLabelText(/almacén de origen/i), { target: { value: 'loc-1' } });
  await screen.findByRole('option', { name: 'Blender' });
}

async function fillOneLine() {
  await chooseOrigin();
  fireEvent.change(screen.getByLabelText(/sucursal de destino/i), { target: { value: 'wh-2' } });
  fireEvent.change(screen.getByLabelText(/almacén de destino/i), { target: { value: 'loc-2' } });
  fireEvent.change(screen.getByLabelText(/producto/i), { target: { value: 'prod-1' } });
  await screen.findByRole('option', { name: 'SKU-9' });
  fireEvent.change(screen.getByLabelText(/variante/i), { target: { value: 'var-9' } });
  fireEvent.change(screen.getByLabelText(/cantidad/i), { target: { value: '4' } });
}

describe('TransferForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockApi({ variants: { 'prod-1': [{ id: 'var-9', sku: 'SKU-9' }, { id: 'var-10', sku: 'SKU-10' }] } });
  });
  afterEach(() => cleanup());

  it('POSTs exactly CreateTransferDto and never a tenantId', async () => {
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/inventory/transfers/t-1?created=1'));
    const createCall = mockedFetch.mock.calls.find(([path]) => path === '/api/v1/inventory/transfers');
    expect(createCall?.[1]).toEqual({
      method: 'POST',
      body: {
        sourceLocationId: 'loc-1',
        destinationLocationId: 'loc-2',
        items: [{ productVariantId: 'var-9', quantityRequested: 4 }],
      },
    });
    expect(JSON.stringify(createCall)).not.toMatch(/tenantId/i);
  });

  it('scopes each Almacén select to its own Sucursal, and resets the almacén when the sucursal changes', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/sucursal de origen/i), { target: { value: 'wh-1' } });
    expect(screen.getByLabelText(/almacén de origen/i)).not.toBeDisabled();
    expect(screen.getByRole('option', { name: 'Central / General' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/almacén de origen/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/sucursal de origen/i), { target: { value: 'wh-2' } });
    expect(screen.getByLabelText(/almacén de origen/i)).toHaveValue('');

    // Origin and destination cascades are independent of each other.
    expect(screen.getByLabelText(/almacén de destino/i)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/sucursal de destino/i), { target: { value: 'wh-1' } });
    expect(screen.getByLabelText(/almacén de destino/i)).not.toBeDisabled();
  });

  it('blocks source === destination client-side', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/sucursal de origen/i), { target: { value: 'wh-1' } });
    fireEvent.change(screen.getByLabelText(/almacén de origen/i), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText(/sucursal de destino/i), { target: { value: 'wh-1' } });
    fireEvent.change(screen.getByLabelText(/almacén de destino/i), { target: { value: 'loc-1' } });

    expect(screen.getByText(/deben ser distintos/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/inventory/transfers')).toHaveLength(0);
  });

  it('Producto stays disabled until an origin is chosen, and only lists products with stock there', async () => {
    mockApi({ productsInStock: { 'loc-1': PRODUCTS, 'loc-2': [{ id: 'prod-2', name: 'Sander' }] } });
    renderForm();
    expect(screen.getByLabelText(/producto/i)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/sucursal de origen/i), { target: { value: 'wh-1' } });
    fireEvent.change(screen.getByLabelText(/almacén de origen/i), { target: { value: 'loc-1' } });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/products-in-stock', { query: { locationId: 'loc-1' } });

    await screen.findByRole('option', { name: 'Blender' });
    expect(screen.getByLabelText(/producto/i)).not.toBeDisabled();
    expect(screen.queryByRole('option', { name: 'Sander' })).not.toBeInTheDocument();
  });

  it('loads variants via GET /products/:id/variants (no tenant-wide list)', async () => {
    renderForm();
    await chooseOrigin();
    fireEvent.change(screen.getByLabelText(/producto/i), { target: { value: 'prod-1' } });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/prod-1/variants');
    expect(await screen.findByRole('option', { name: 'SKU-9' })).toBeInTheDocument();
  });

  it('auto-selects the variant when a product has exactly one, without a Variante dropdown', async () => {
    mockApi({ variants: { 'prod-1': [{ id: 'var-solo', sku: 'SKU-SOLO' }] } });
    renderForm();
    await chooseOrigin();
    fireEvent.change(screen.getByLabelText(/producto/i), { target: { value: 'prod-1' } });

    await screen.findByText('SKU-SOLO');
    expect(screen.queryByLabelText(/variante/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/cantidad/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    // Destination still required, but the variant itself never blocked submission.
    expect(screen.queryByText(/elige una variante/i)).not.toBeInTheDocument();
  });

  it('shows stock disponible for the chosen variant + source location and blocks over-requesting it', async () => {
    mockApi({ variants: { 'prod-1': [{ id: 'var-9', sku: 'SKU-9' }, { id: 'var-10', sku: 'SKU-10' }] }, stock: 5 });
    renderForm();
    await fillOneLine();
    await screen.findByText('5');

    fireEvent.change(screen.getByLabelText(/cantidad/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    expect(await screen.findByText(/no puede superar el stock disponible \(5\)/i)).toBeInTheDocument();
    expect(mockedFetch.mock.calls.filter(([p, i]) => p === '/api/v1/inventory/transfers' && (i as { method?: string })?.method === 'POST')).toHaveLength(0);
  });

  it('always shows a × on the only line, and resets it to empty instead of removing it', async () => {
    renderForm();
    await fillOneLine();
    const removeButtons = screen.getAllByRole('button', { name: /quitar fila/i });
    expect(removeButtons).toHaveLength(1);

    fireEvent.click(removeButtons[0]!);
    // Still exactly one line, now empty.
    expect(screen.getAllByRole('button', { name: /quitar fila/i })).toHaveLength(1);
    expect(screen.getByLabelText(/producto/i)).toHaveValue('');
  });

  it('+ adds a line, × removes just the targeted row when two or more exist', async () => {
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    expect(screen.getAllByLabelText(/producto/i)).toHaveLength(2);

    const removeButtons = screen.getAllByRole('button', { name: /quitar fila/i });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[1]!);
    expect(screen.getAllByLabelText(/producto/i)).toHaveLength(1);
    // The remaining line keeps its data — only the targeted (second, empty) row was removed.
    expect(screen.getByLabelText(/producto/i)).toHaveValue('prod-1');
  });

  it('hides the repeated column labels (sm:sr-only) on every line after the first', async () => {
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));

    const productLabels = screen.getAllByText('Producto', { selector: 'label' });
    expect(productLabels).toHaveLength(2);
    expect(productLabels[0]?.parentElement?.className ?? '').not.toMatch(/sr-only/);
    expect(productLabels[1]?.parentElement?.className ?? '').toMatch(/sm:sr-only/);
  });

  it('restricts Sucursal/Almacén de origen to the scoped list and auto-selects a single option', () => {
    const scoped = [{ id: 'wh-1', name: 'Sucursal Central' }];
    renderForm({ sourceWarehouses: scoped, scope: { unrestricted: false, locationIds: ['loc-1'] } });

    // Destination keeps the full, unrestricted list.
    expect(screen.getByRole('option', { name: 'Sucursal Norte' })).toBeInTheDocument();
    // Origin auto-selected its only warehouse and, from that, its only assigned location.
    expect(screen.getByLabelText(/sucursal de origen/i)).toHaveValue('wh-1');
    expect(screen.getByLabelText(/almacén de origen/i)).toHaveValue('loc-1');
  });

  it('shows a warning and disables the origin picker when the user has no assigned location', () => {
    renderForm({ sourceWarehouses: [], scope: { unrestricted: false, locationIds: [] } });
    expect(screen.getByText(/no tienes ningún almacén asignado como origen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sucursal de origen/i)).toBeDisabled();
  });

  it('disables Producto and explains why when the caller cannot view inventory', () => {
    renderForm({ canViewInventory: false });
    expect(screen.getByLabelText(/producto/i)).toBeDisabled();
    expect(screen.getByRole('option', { name: /no puedes ver el inventario/i })).toBeInTheDocument();
  });

  it('shows a location-authorization message on 403 and does not redirect', async () => {
    mockApi({
      variants: { 'prod-1': [{ id: 'var-9', sku: 'SKU-9' }, { id: 'var-10', sku: 'SKU-10' }] },
      create: new ApiError(403, 'FORBIDDEN', 'nope', undefined),
    });
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    expect(await screen.findByText(/no tienes autorización para crear una transferencia/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces a 409 (e.g. insufficient stock re-validated server-side) safely', async () => {
    mockApi({
      variants: { 'prod-1': [{ id: 'var-9', sku: 'SKU-9' }, { id: 'var-10', sku: 'SKU-10' }] },
      create: new ApiError(409, 'CONFLICT', 'Stock insuficiente para la variante var-9 en el almacén de origen. Disponible: 3.', undefined),
    });
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    expect(await screen.findByText(/stock insuficiente/i)).toBeInTheDocument();
  });

  it('does not fire a second request on a double submit', async () => {
    renderForm();
    await fillOneLine();
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementation(
      (path: string, init?: { method?: string }) =>
        new Promise((r) => {
          if (path === '/api/v1/inventory/transfers' && init?.method === 'POST') {
            resolve = r;
          } else {
            r({ data: [{ quantityAvailable: 1000 }] });
          }
        }),
    );
    const btn = screen.getByRole('button', { name: /crear transferencia/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p, i]) => p === '/api/v1/inventory/transfers' && (i as { method?: string })?.method === 'POST')).toHaveLength(1);
    resolve({ id: 't-1' });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('never writes to browser storage', async () => {
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
