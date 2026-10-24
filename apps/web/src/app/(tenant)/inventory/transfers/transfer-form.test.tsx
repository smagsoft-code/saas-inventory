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
interface Hit {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  quantityAvailable: number;
}
const BLENDER: Hit = {
  productId: 'prod-1',
  productName: 'Blender',
  variantId: 'var-9',
  sku: 'SKU-9',
  quantityAvailable: 1000,
};
const UNRESTRICTED: LocationScope = { unrestricted: true, locationIds: [] };

/** Routes every `apiFetch` call by path/method/query instead of a strict FIFO queue — the form fires
 * several order-varying calls (product search, stock disponible, the final create). `hits` is what the
 * product search finds per origin location (filtered by name or code like the real endpoint). */
function mockApi(
  opts: { stock?: number; hits?: Record<string, Hit[]>; create?: unknown | Error } = {},
): void {
  const hits = opts.hits ?? { 'loc-1': [BLENDER] };
  mockedFetch.mockImplementation(
    async (path: string, init?: { method?: string; query?: Record<string, unknown> }) => {
      if (path === '/api/v1/inventory/products-in-stock/variants') {
        const locationId = init?.query?.['locationId'] as string | undefined;
        const q = String(init?.query?.['q'] ?? '').toLowerCase();
        return ((locationId ? hits[locationId] : undefined) ?? []).filter(
          (hit) => hit.productName.toLowerCase().includes(q) || hit.sku.toLowerCase().includes(q),
        );
      }
      if (path === '/api/v1/inventory/balances') {
        return { data: [{ quantityAvailable: opts.stock ?? 1000 }] };
      }
      if (path === '/api/v1/inventory/transfers' && init?.method === 'POST') {
        if (opts.create instanceof Error) throw opts.create;
        return opts.create ?? { id: 't-1' };
      }
      throw new Error(`Unexpected apiFetch call: ${path}`);
    },
  );
}

function renderForm(
  overrides: {
    sourceWarehouses?: typeof WAREHOUSES;
    scope?: LocationScope;
    canViewInventory?: boolean;
  } = {},
) {
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
}

/** Types into the Producto search box and picks the hit named `label` (the search is debounced). */
async function searchAndPick(term: string, label: string, index = 0): Promise<void> {
  fireEvent.change(screen.getAllByLabelText(/producto/i)[index]!, { target: { value: term } });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
}

async function fillOneLine() {
  await chooseOrigin();
  fireEvent.change(screen.getByLabelText(/sucursal de destino/i), { target: { value: 'wh-2' } });
  fireEvent.change(screen.getByLabelText(/almacén de destino/i), { target: { value: 'loc-2' } });
  await searchAndPick('blen', 'Blender');
  fireEvent.change(screen.getByLabelText(/cantidad/i), { target: { value: '4' } });
}

describe('TransferForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockApi();
  });
  afterEach(() => cleanup());

  it('POSTs exactly CreateTransferDto and never a tenantId', async () => {
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith('/inventory/transfers/t-1?created=1'),
    );
    const createCall = mockedFetch.mock.calls.find(
      ([path]) => path === '/api/v1/inventory/transfers',
    );
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
    expect(
      mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/inventory/transfers'),
    ).toHaveLength(0);
  });

  it('Producto stays disabled until an origin is chosen; then it searches by name or code, only among what is in stock there', async () => {
    mockApi({
      hits: {
        'loc-1': [BLENDER],
        'loc-2': [
          {
            ...BLENDER,
            productName: 'Sander',
            sku: 'SND-1',
            variantId: 'var-s',
            productId: 'prod-2',
          },
        ],
      },
    });
    renderForm();
    expect(screen.getByLabelText(/producto/i)).toBeDisabled();

    await chooseOrigin();
    const box = screen.getByLabelText(/producto/i);
    expect(box).not.toBeDisabled();
    fireEvent.change(box, { target: { value: 'SKU-9' } }); // by code
    expect(await screen.findByRole('button', { name: /Blender/ })).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/products-in-stock/variants', {
      query: { locationId: 'loc-1', q: 'SKU-9' },
    });
    fireEvent.change(box, { target: { value: 'sander' } }); // other origin's product is not offered
    expect(await screen.findByText(/ningún producto con stock coincide/i)).toBeInTheDocument();
  });

  it('picking a hit fills the line with its code and available stock (no variant drop-down)', async () => {
    mockApi({ hits: { 'loc-1': [{ ...BLENDER, quantityAvailable: 7 }] } });
    renderForm();
    await chooseOrigin();
    await searchAndPick('blen', 'Blender');

    expect(screen.getByLabelText(/producto/i)).toHaveValue('Blender');
    expect(screen.getAllByText('SKU-9').length).toBeGreaterThan(0);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByLabelText(/variante/i)).not.toBeInTheDocument();
  });

  it('blocks a quantity above the stock of the picked hit', async () => {
    mockApi({ hits: { 'loc-1': [{ ...BLENDER, quantityAvailable: 3 }] } });
    renderForm();
    await fillOneLine(); // quantity 4 > stock 3
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    expect(
      await screen.findByText(/no puede superar el stock disponible \(3\)/i),
    ).toBeInTheDocument();
    expect(
      mockedFetch.mock.calls.filter(
        ([p, i]) =>
          p === '/api/v1/inventory/transfers' && (i as { method?: string })?.method === 'POST',
      ),
    ).toHaveLength(0);
  });

  it('the notes box is collapsed until "+ Agregar notas" is pressed, like the receive modal', async () => {
    renderForm();
    expect(screen.queryByRole('textbox', { name: /notas/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /agregar notas/i }));
    expect(screen.getByRole('textbox', { name: /notas/i })).toBeInTheDocument();
  });

  it('shows a location-authorization message on 403 and does not redirect', async () => {
    mockApi({
      create: new ApiError(403, 'FORBIDDEN', 'nope', undefined),
    });
    renderForm();
    await fillOneLine();
    fireEvent.click(screen.getByRole('button', { name: /crear transferencia/i }));
    expect(
      await screen.findByText(/no tienes autorización para crear una transferencia/i),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces a 409 (e.g. insufficient stock re-validated server-side) safely', async () => {
    mockApi({
      create: new ApiError(
        409,
        'CONFLICT',
        'Stock insuficiente para la variante var-9 en el almacén de origen. Disponible: 3.',
        undefined,
      ),
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
    expect(
      mockedFetch.mock.calls.filter(
        ([p, i]) =>
          p === '/api/v1/inventory/transfers' && (i as { method?: string })?.method === 'POST',
      ),
    ).toHaveLength(1);
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

  it('phone steppers raise and lower the quantity and never go below 0', async () => {
    renderForm();
    await fillOneLine();
    const quantity = screen.getByLabelText(/cantidad/i);
    fireEvent.click(screen.getByRole('button', { name: 'Sumar uno' }));
    expect(quantity).toHaveValue(5);
    fireEvent.click(screen.getByRole('button', { name: 'Restar uno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restar uno' }));
    expect(quantity).toHaveValue(3);
    for (let i = 0; i < 5; i += 1)
      fireEvent.click(screen.getByRole('button', { name: 'Restar uno' }));
    expect(quantity).toHaveValue(0);
  });

  it('shows the chosen route and the product count in the phone cards', async () => {
    renderForm();
    await fillOneLine();
    const route = screen.getByRole('region', { name: 'Ruta elegida' });
    expect(route).toHaveTextContent(/origen/i);
    expect(route).toHaveTextContent(/destino/i);
    expect(screen.getByText('1 producto')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /añadir producto/i }));
    expect(screen.getByText('2 productos')).toBeInTheDocument();
  });

  it('phone: origin and destination fold once chosen and reopen from the route summary', async () => {
    renderForm();
    await fillOneLine();
    const origin = screen.getByRole('button', { name: 'Editar origen' });
    const destination = screen.getByRole('button', { name: 'Editar destino' });
    expect(origin).toHaveAttribute('aria-expanded', 'false');
    expect(destination).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(origin);
    expect(origin).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(destination);
    expect(destination).toHaveAttribute('aria-expanded', 'true');
    // clearing the almacén opens that side again on its own
    fireEvent.change(screen.getByLabelText(/sucursal de origen/i), { target: { value: 'wh-2' } });
    expect(origin).toHaveAttribute('aria-expanded', 'true');
  });
});
