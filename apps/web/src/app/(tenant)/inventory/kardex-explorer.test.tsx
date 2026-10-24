import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import * as kardexLib from '../../../lib/inventory/kardex';
import type { KardexResponse } from '../../../lib/types/kardex';
import { KardexExplorer, type LocationOption } from './kardex-explorer';

vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/inventory/kardex', async () => {
  const actual = await vi.importActual<typeof kardexLib>('../../../lib/inventory/kardex');
  return { ...actual, getKardex: vi.fn() };
});

const mockedFetch = vi.mocked(apiFetch);
const mockedGetKardex = vi.mocked(kardexLib.getKardex);

const LOCATIONS: LocationOption[] = [{ id: 'loc-1', name: 'Almacén Principal', warehouseId: 'w-1', warehouseName: 'Sucursal Centro' }];

const KARDEX_RESPONSE: KardexResponse = {
  productVariantId: 'v1',
  locationId: 'loc-1',
  productId: 'p1',
  productName: 'Silla de Comedor',
  sku: 'SILLA-1',
  opening: { stockUnits: 0, averageCost: 0, stockValue: 0, estimated: true },
  rows: [
    {
      movementId: 'm1',
      occurredAt: '2026-01-05T00:00:00Z',
      movementType: 'RECEIPT',
      label: 'Ingreso de stock: Restock',
      entrada: 10,
      salida: 0,
      unitCost: 5,
      unitCostEstimated: true,
      averageCostAfter: 5,
      stockAfter: 10,
      stockValueAfter: 50,
    },
  ],
  closing: { stockUnits: 10, averageCost: 5, stockValue: 50, estimated: true },
  truncated: false,
  stockByLocation: [{ locationId: 'loc-1', locationName: 'Almacén Principal', warehouseName: 'Sucursal Centro', stockPhysical: 10, stockAvailable: 10 }],
};

function renderExplorer(locations: LocationOption[] = LOCATIONS) {
  return render(<KardexExplorer locations={locations} />);
}

/** Real time, not fake timers — `waitFor`'s own polling relies on real timers, and mixing the two
 * deadlocks. The debounce is only 250ms, so a real wait is cheap enough. Typing directly (no
 * separate focus step) is enough to open the picker — there's no "Ver todos" button and no
 * "Seleccionar" button: clicking a result selects it immediately. */
async function selectProductFromSearch(name: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: name } });
  // A real <button>, not plain text — "Ver todos"'s own Producto column can show the same name as
  // inert table-cell text at the same time, so matching by role avoids that ambiguity.
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }, { timeout: 2000 }));
}

describe('KardexExplorer', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders the empty state and fetches nothing on mount', () => {
    renderExplorer();
    expect(screen.getByText('Busca un producto para consultar su kardex')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedGetKardex).not.toHaveBeenCalled();
  });

  it('opens the picker as "Ver todos" the instant the search box is focused, with an empty query', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } });
    renderExplorer();

    fireEvent.focus(screen.getByLabelText('Buscar producto'));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/reports/product-catalog', { query: { page: 1, pageSize: 10 } }));
    expect(await screen.findByText('Silla de Comedor')).toBeInTheDocument();
    // No "Seleccionar" confirming button anywhere — the panel itself is the browse view, and its
    // rows select on click. ("Ver todos" itself is a real, separate button — the tenant-wide
    // all-movements trial, not this per-product picker.)
    expect(screen.queryByRole('button', { name: 'Seleccionar' })).not.toBeInTheDocument();
    // No Sucursal/Categoría filters either — removed per owner feedback.
    expect(screen.queryByLabelText('Sucursal')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
  });

  it('"Ver todos" shows a flat, tenant-wide movement feed with the same columns as the per-variant Kardex, plus Almacén', async () => {
    mockedFetch.mockResolvedValueOnce({
      data: [
        { id: 'm1', productVariantId: 'v1', locationId: 'loc-1', movementType: 'RECEIPT', quantity: 10, balanceAfter: 10, actorType: 'user', occurredAt: '2026-01-05T00:00:00Z', createdAt: '2026-01-05T00:00:00Z' },
      ],
      meta: { total: 1, totalPages: 1 },
    });
    // The per-pair Kardex call that supplies the correctly-computed Costo K / Stock / V.Total for
    // this specific (variant, location) — the same engine the per-variant table uses, reused here.
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);

    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/movements', { query: { page: 1, pageSize: 20 } }));
    await waitFor(() => expect(mockedGetKardex).toHaveBeenCalledWith({ productVariantId: 'v1', locationId: 'loc-1' }));
    expect(await screen.findByText('Todos los movimientos')).toBeInTheDocument();
    expect(screen.getByText('Ingreso de stock: Restock')).toBeInTheDocument(); // the Kardex row's own (richer) label
    expect(screen.getByText('Producto')).toBeInTheDocument();
    expect(screen.getByText('Almacén')).toBeInTheDocument();
    expect(screen.getAllByText('Silla de Comedor').length).toBeGreaterThan(0); // the row's own Producto cell
    expect(screen.getByText('Sucursal Centro — Almacén Principal')).toBeInTheDocument();

    // Selecting a product from then on exits "Ver todos" back to the normal per-product Kardex.
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] });
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);
    await selectProductFromSearch('Silla de Comedor');
    expect(screen.queryByText('Todos los movimientos')).not.toBeInTheDocument();
    expect(await screen.findByText('Ingreso de stock: Restock')).toBeInTheDocument();
  }, 10000);

  it('clicking a row in "Ver todos" jumps to that exact product\'s Kardex, taking the row\'s own almacén even when the variant has stock in more than one', async () => {
    const twoLocations: LocationOption[] = [
      { id: 'loc-1', name: 'Almacén Principal', warehouseId: 'w-1', warehouseName: 'Sucursal Centro' },
      { id: 'loc-2', name: 'Almacén Norte', warehouseId: 'w-2', warehouseName: 'Sucursal Norte' },
    ];
    mockedFetch.mockResolvedValueOnce({
      data: [{ id: 'm1', productVariantId: 'v1', locationId: 'loc-1', movementType: 'RECEIPT', quantity: 10, balanceAfter: 10, actorType: 'user', occurredAt: '2026-01-05T00:00:00Z', createdAt: '2026-01-05T00:00:00Z' }],
      meta: { total: 1, totalPages: 1 },
    });
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE); // productId: 'p1', locationId: 'loc-1'

    renderExplorer(twoLocations);
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    await screen.findByText('Todos los movimientos');
    const row = screen.getByText('Ingreso de stock: Restock').closest('tr')!;

    // The variant has stock in both locations, but the clicked row already carries its own —
    // no "elige un almacén" prompt should ever appear.
    mockedFetch
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }]) // GET /products/p1/variants
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }, { locationId: 'loc-2' }] }); // balances: both locations
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);

    fireEvent.click(row);

    expect(screen.queryByText('Todos los movimientos')).not.toBeInTheDocument();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants'));
    await waitFor(() => expect(mockedGetKardex).toHaveBeenLastCalledWith({ productVariantId: 'v1', locationId: 'loc-1' }));
    expect(await screen.findByText('Producto seleccionado')).toBeInTheDocument();
    expect(screen.getByText('Silla de Comedor')).toBeInTheDocument();
    // The card also names the variant's code, to the LEFT of the product name (like a search result).
    const codeEl = screen.getByText('SILLA-1');
    const nameEl = screen.getByText('Silla de Comedor');
    expect(codeEl.compareDocumentPosition(nameEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Elige un almacén para ver su kardex')).not.toBeInTheDocument();
  }, 10000);

  it('places the search box and the date filters in a single row', () => {
    renderExplorer();
    const search = screen.getByLabelText('Buscar producto');
    const from = screen.getByLabelText('Fecha inicio');
    const to = screen.getByLabelText('Fecha fin');
    // Same row = same immediate flex-row ancestor.
    const row = search.closest('.flex.flex-wrap.items-end');
    expect(row).toContainElement(from);
    expect(row).toContainElement(to);
  });

  it('debounces typed input and calls GET /products with q, narrowing the same panel', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } });
    renderExplorer();

    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'Silla' } });
    expect(mockedFetch).not.toHaveBeenCalled(); // not yet — still debouncing

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/reports/product-catalog', { query: { page: 1, pageSize: 10, q: 'Silla' } }), { timeout: 2000 });
    expect(await screen.findByText('Silla de Comedor')).toBeInTheDocument();
  }, 10000);

  it('each search result shows the variant code at the LEFT of the product name, in one compact line', async () => {
    mockedFetch.mockResolvedValueOnce({
      data: [
        { productId: 'p1', productName: 'PEINADORA MODERNA CON ESPEJO Y LUCES LED', variantId: 'v1', sku: 'PEI-021' },
        { productId: 'p2', productName: 'PEINADORA DOBLE', variantId: 'v2', sku: 'PEI-022' },
      ],
      meta: { total: 2, totalPages: 1 },
    });
    renderExplorer();
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'pei' } });
    const option = await screen.findByRole('button', { name: /PEI-021/ }, { timeout: 2000 });
    const [code, name] = Array.from(option.querySelectorAll('span'));
    expect(code).toHaveTextContent('PEI-021');
    expect(name).toHaveTextContent('PEINADORA MODERNA CON ESPEJO Y LUCES LED');
    expect(option.textContent!.indexOf('PEI-021')).toBeLessThan(option.textContent!.indexOf('PEINADORA'));
    // compact: a single flex row with tight vertical padding, the name truncates instead of wrapping
    expect(option).toHaveClass('flex', 'items-center', 'py-0.5', 'gap-1.5');
    expect(name).toHaveClass('truncate');
  }, 10000);

  it('picking a result that names a variant selects THAT variant (even when its product has several)', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v2', sku: 'SILLA-2' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }, { id: 'v2', sku: 'SILLA-2' }]) // variants of the product
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] }); // balances
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);
    renderExplorer();
    await selectProductFromSearch('SILLA-2');
    await waitFor(() => expect(mockedGetKardex).toHaveBeenCalledWith({ productVariantId: 'v2', locationId: 'loc-1' }));
  }, 10000);

  it('selecting a result is a single click — no confirming button', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } }) // search
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }]) // variants
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] }); // balances
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);

    renderExplorer();
    await selectProductFromSearch('Silla de Comedor');

    await waitFor(() => expect(mockedGetKardex).toHaveBeenCalledWith({ productVariantId: 'v1', locationId: 'loc-1' }));
    expect(await screen.findByText('Ingreso de stock: Restock')).toBeInTheDocument();
    // Almacén auto-selected, shown as text rather than a picker (only one option) — appears both
    // in "Producto seleccionado" and in "Stock por sucursal", hence getAllByText.
    expect(screen.getAllByText(/Sucursal Centro/).length).toBeGreaterThan(0);
  }, 10000);

  it('shows the closing balance (Stock disponible, with $ costs) in the "producto seleccionado" card, and never the word "estimado"', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] });
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE); // opening/closing both flagged estimated:true

    renderExplorer();
    await selectProductFromSearch('Silla de Comedor');
    await screen.findByText('Ingreso de stock: Restock');

    expect(screen.getByText('Stock disponible')).toBeInTheDocument();
    expect(screen.queryByText('Saldo final')).not.toBeInTheDocument();
    // "10" appears both in the summary card and the table's own Stock column — no "u." suffix.
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getByText('Costo promedio')).toBeInTheDocument();
    expect(screen.getByText('$5.00')).toBeInTheDocument();
    expect(screen.getByText('Valor')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    // "Saldo inicial" is gone entirely (not shown, not relocated).
    expect(screen.queryByText(/saldo inicial/i)).not.toBeInTheDocument();
    // Even though this response is flagged estimated on both opening and closing, the word never
    // renders anywhere in the UI.
    expect(screen.queryByText(/estimado/i)).not.toBeInTheDocument();
    expect(screen.queryByText('est.')).not.toBeInTheDocument();
  }, 10000);

  it('toggles sort order with a single click on the icon button inside the "Fecha del movimiento" header cell', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] });
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);

    renderExplorer();
    await selectProductFromSearch('Silla de Comedor');
    await screen.findByText('Ingreso de stock: Restock');

    // No standalone "Más antiguo"/"Más reciente" button in the filters row anymore.
    expect(screen.queryByRole('button', { name: /más antiguo/i })).not.toBeInTheDocument();

    const sortButton = screen.getByRole('button', { name: 'Invertir orden cronológico' });
    fireEvent.click(sortButton);
    // Toggling display order is client-side only — no extra kardex fetch.
    expect(mockedGetKardex).toHaveBeenCalledTimes(1);
  }, 10000);

  it('rejects a fecha inicio after fecha fin and skips the kardex fetch for that invalid range', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] });
    // Persistent (not `Once`) — an intermediate valid state (fecha inicio alone, before fecha fin
    // is set) legitimately refetches once more before the range becomes invalid.
    mockedGetKardex.mockResolvedValue(KARDEX_RESPONSE);

    renderExplorer();
    await selectProductFromSearch('Silla de Comedor');
    await waitFor(() => expect(mockedGetKardex).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Fecha inicio'), { target: { value: '2026-02-10' } });
    fireEvent.change(screen.getByLabelText('Fecha fin'), { target: { value: '2026-02-01' } });

    expect((await screen.findAllByText(/fecha inicio debe ser anterior/i)).length).toBeGreaterThan(0);
    const callsWithInvalidRange = mockedGetKardex.mock.calls.filter(([q]) => q.from === '2026-02-10T00:00:00.000Z' && q.to === '2026-02-01T00:00:00.000Z');
    expect(callsWithInvalidRange).toHaveLength(0);
  }, 10000);

  it('refetches the kardex immediately with the [from, to) range converted from the date pickers', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] });
    mockedGetKardex.mockResolvedValue(KARDEX_RESPONSE);

    renderExplorer();
    await selectProductFromSearch('Silla de Comedor');
    await waitFor(() => expect(mockedGetKardex).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Fecha inicio'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Fecha fin'), { target: { value: '2026-01-31' } });

    await waitFor(() =>
      expect(mockedGetKardex).toHaveBeenLastCalledWith({
        productVariantId: 'v1',
        locationId: 'loc-1',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      }),
    );
  }, 10000);

  it('shows an ErrorState with retry when the kardex call fails', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] });
    mockedGetKardex.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom', 'corr-1'));

    renderExplorer();
    await selectProductFromSearch('Silla de Comedor');

    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();

    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Ingreso de stock: Restock')).toBeInTheDocument();
  }, 10000);

  it('renders Stock por sucursal after the Kardex, with icon-only export links (top of the table) carrying the current filters', async () => {
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }] });
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);

    renderExplorer();
    await selectProductFromSearch('Silla de Comedor');
    await screen.findByText('Ingreso de stock: Restock');

    expect(screen.getByText('Stock por sucursal')).toBeInTheDocument();
    // Icon-only — no visible "Exportar a Excel"/"Exportar a PDF" text, only the accessible name.
    expect(screen.queryByText('Exportar a Excel')).not.toBeInTheDocument();
    expect(screen.queryByText('Exportar a PDF')).not.toBeInTheDocument();
    const excelLink = screen.getByRole('link', { name: 'Exportar a Excel' });
    expect(excelLink).toHaveAttribute('href', expect.stringContaining('productVariantId=v1'));
    expect(excelLink).toHaveAttribute('href', expect.stringContaining('locationId=loc-1'));
    expect(excelLink).toHaveAttribute('href', expect.stringContaining('format=xlsx'));
    expect(screen.getByRole('link', { name: 'Exportar a PDF' })).toHaveAttribute('href', expect.stringContaining('format=pdf'));
    // Sit next to the "Kardex" heading, not below the table.
    const heading = screen.getByRole('heading', { name: 'Kardex' });
    expect(heading.parentElement).toContainElement(excelLink);
  }, 10000);

  it('shows a variant picker when a product has more than one variant, and a location picker when the variant has stock in more than one location', async () => {
    const twoLocations: LocationOption[] = [
      { id: 'loc-1', name: 'Almacén Principal', warehouseId: 'w-1', warehouseName: 'Sucursal Centro' },
      { id: 'loc-2', name: 'Almacén Norte', warehouseId: 'w-2', warehouseName: 'Sucursal Norte' },
    ];
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([
        { id: 'v1', sku: 'SILLA-1-ROJA' },
        { id: 'v2', sku: 'SILLA-1-AZUL' },
      ])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }, { locationId: 'loc-2' }] }); // balances of v1

    renderExplorer(twoLocations);
    await selectProductFromSearch('Silla de Comedor');

    // The hit names variant v1, so it is selected for the user (no "elige una variante" dead end) and, with
    // stock in two almacenes, only the almacén is left to choose.
    expect(await screen.findByText('Elige un almacén para ver su kardex')).toBeInTheDocument();
    expect(screen.getByLabelText('Variante')).toHaveValue('v1');
    expect(mockedGetKardex).not.toHaveBeenCalled();

    // The variant picker is still there to switch to the product's other variant.
    mockedFetch.mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }, { locationId: 'loc-2' }] });
    mockedGetKardex.mockResolvedValueOnce(KARDEX_RESPONSE);
    fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'v2' } });

    expect(await screen.findByText('Elige un almacén para ver su kardex')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'loc-2' } });
    await waitFor(() => expect(mockedGetKardex).toHaveBeenCalledWith({ productVariantId: 'v2', locationId: 'loc-2' }));
  }, 10000);
  it('"Todos los almacenes" shows the stock / weighted-average cost / total cost across locations, with a collapsible per-sucursal breakdown', async () => {
    const twoLocations: LocationOption[] = [
      { id: 'loc-1', name: 'Almacén Principal', warehouseId: 'w-1', warehouseName: 'Sucursal Centro' },
      { id: 'loc-2', name: 'Almacén Norte', warehouseId: 'w-2', warehouseName: 'Sucursal Norte' },
    ];
    mockedFetch
      .mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Silla de Comedor', variantId: 'v1', sku: 'SILLA-1' }], meta: { total: 1, totalPages: 1 } })
      .mockResolvedValueOnce([{ id: 'v1', sku: 'SILLA-1' }])
      .mockResolvedValueOnce({ data: [{ locationId: 'loc-1' }, { locationId: 'loc-2' }] });
    // loc-1: 10 units @ 5 = 50 ; loc-2: 30 units @ 9 = 270  ->  40 units, 320 total, 8.00 average.
    mockedGetKardex.mockImplementation((async (query: { locationId: string }) => ({
      ...KARDEX_RESPONSE,
      locationId: query.locationId,
      closing:
        query.locationId === 'loc-1'
          ? { stockUnits: 10, averageCost: 5, stockValue: 50 }
          : { stockUnits: 30, averageCost: 9, stockValue: 270 },
    })) as never);

    renderExplorer(twoLocations);
    await selectProductFromSearch('Silla de Comedor');
    await screen.findByRole('option', { name: 'Todos los almacenes' });
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: '__all__' } });

    const totals = await screen.findByTestId('all-locations-totals');
    expect(totals).toHaveTextContent('Stock disponible');
    expect(totals).toHaveTextContent('40');
    expect(totals).toHaveTextContent('Costo promedio');
    expect(totals).toHaveTextContent('$8.00');
    expect(totals).toHaveTextContent('Costo total');
    expect(totals).toHaveTextContent('$320.00');
    // The per-location ledger is not merged: no Kardex table in this mode.
    expect(screen.getByText('Mostrando los totales de todos los almacenes')).toBeInTheDocument();

    // Collapsed by default; opens to the per-sucursal / almacén rows.
    expect(screen.queryByText('Sucursal Norte')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /existencias por sucursal y almacén/i }));
    expect(screen.getByText('Sucursal Norte')).toBeInTheDocument();
    expect(screen.getByText('Almacén Norte')).toBeInTheDocument();
    expect(screen.getByText('$270.00')).toBeInTheDocument();

    // Back to a single almacén restores its own Kardex.
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'loc-2' } });
    await waitFor(() => expect(mockedGetKardex).toHaveBeenLastCalledWith({ productVariantId: 'v1', locationId: 'loc-2' }));
    await waitFor(() => expect(screen.queryByTestId('all-locations-totals')).not.toBeInTheDocument());
  }, 10000);
});
