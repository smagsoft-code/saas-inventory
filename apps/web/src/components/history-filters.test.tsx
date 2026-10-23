import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/api/client';
import { HistoryDateFilters, HistoryFilters, HistoryLocationFilters, type HistoryFilterValues } from './history-filters';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const TODAY = '2026-10-13';

const STATUSES = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'confirmed', label: 'Confirmado' },
];
const DOC_TYPES = [
  { value: 'invoice', label: 'Factura' },
  { value: 'sales_note', label: 'Nota de venta' },
];

const LOCS = [
  { id: 'l-1', name: 'Bodega Norte' },
  { id: 'l-2', name: 'Bodega Sur' },
];

function bar(
  initial: Partial<HistoryFilterValues> = {},
  opts: { canSearchCustomers?: boolean; customerName?: string; locations?: typeof LOCS; allowAll?: boolean; defaultLocationId?: string; noDocType?: boolean; preserve?: Record<string, string>; sellers?: { value: string; label: string }[] } = {},
): React.JSX.Element {
  const full: HistoryFilterValues = { dateFrom: TODAY, ...initial };
  return (
    <>
      <HistoryDateFilters basePath="/sales" initial={full} today={TODAY} preserve={opts.preserve} />
      <HistoryFilters
        basePath="/sales"
        statusOptions={STATUSES}
        documentTypeOptions={opts.noDocType ? undefined : DOC_TYPES}
        initial={full}
        today={TODAY}
        defaultLocationId={opts.defaultLocationId}
        locations={opts.locations ?? LOCS}
        allowAllLocations={opts.allowAll ?? true}
        canSearchCustomers={opts.canSearchCustomers ?? true}
        customerName={opts.customerName}
        sellerOptions={opts.sellers}
        preserve={opts.preserve}
      />
    </>
  );
}

function renderFilters(
  initial: Partial<HistoryFilterValues> = {},
  canSearchCustomers = true,
  customerName?: string,
): void {
  render(bar(initial, { canSearchCustomers, ...(customerName ? { customerName } : {}) }));
}

function lastUrl(): URL {
  const href = pushMock.mock.calls.at(-1)![0] as string;
  return new URL(href, 'http://localhost');
}

beforeEach(() => {
  pushMock.mockReset();
  mockedFetch.mockReset();
});

describe('HistoryFilters', () => {
  it('has Almacén, Tipo de documento, Estado, Cliente (in that order) plus Desde/Hasta — no Agrupar por / Descuento excepcional, no hint text', () => {
    renderFilters();
    const order = [screen.getByLabelText('Almacén'), screen.getByLabelText('Tipo de documento'), screen.getByLabelText('Estado'), screen.getByLabelText('Buscar cliente')];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i]!.compareDocumentPosition(order[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText(/Vacío = solo/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Desde')).toHaveValue(TODAY);
    expect(screen.getByLabelText(/Hasta/)).toHaveValue('');
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo de documento')).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar cliente')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Agrupar por/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Descuento excepcional/)).not.toBeInTheDocument();
  });

  it('Desde with empty Hasta navigates with dateFrom only (single day) and never sends a page param', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-05' } });
    fireEvent.blur(screen.getByLabelText('Desde'));
    fireEvent.blur(screen.getByLabelText('Desde'));
    const url = lastUrl();
    expect(url.pathname).toBe('/sales');
    expect(url.searchParams.get('dateFrom')).toBe('2026-10-05');
    expect(url.searchParams.has('dateTo')).toBe(false);
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('a range sends both dates as plain calendar days (no UTC instants)', () => {
    renderFilters({ dateFrom: '2026-10-05' });
    fireEvent.change(screen.getByLabelText(/Hasta/), { target: { value: '2026-10-08' } });
    fireEvent.blur(screen.getByLabelText(/Hasta/));
    fireEvent.blur(screen.getByLabelText(/Hasta/));
    const url = lastUrl();
    expect(url.searchParams.get('dateFrom')).toBe('2026-10-05');
    expect(url.searchParams.get('dateTo')).toBe('2026-10-08');
  });

  it('Hasta equal to Desde collapses to a single day', () => {
    renderFilters({ dateFrom: '2026-10-05' });
    fireEvent.change(screen.getByLabelText(/Hasta/), { target: { value: '2026-10-05' } });
    fireEvent.blur(screen.getByLabelText(/Hasta/));
    fireEvent.blur(screen.getByLabelText(/Hasta/));
    expect(lastUrl().searchParams.has('dateTo')).toBe(false);
  });

  it('clearing Desde returns to today (explicit, never an open-ended range)', () => {
    renderFilters({ dateFrom: '2026-10-05' });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '' } });
    fireEvent.blur(screen.getByLabelText('Desde'));
    fireEvent.blur(screen.getByLabelText('Desde'));
    expect(lastUrl().searchParams.get('dateFrom')).toBe(TODAY);
  });

  it('status and document type compose with the current dates and customer', () => {
    renderFilters({ dateFrom: '2026-10-05', dateTo: '2026-10-08', customerId: 'c-1' }, true, 'Acme');
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'confirmed' } });
    fireEvent.change(screen.getByLabelText('Tipo de documento'), { target: { value: 'invoice' } });
    const url = lastUrl();
    expect(url.searchParams.get('dateFrom')).toBe('2026-10-05');
    expect(url.searchParams.get('dateTo')).toBe('2026-10-08');
    expect(url.searchParams.get('customerId')).toBe('c-1');
    expect(url.searchParams.get('documentType')).toBe('invoice');
  });

  it('customer search is debounced, hits GET /customers?q=, and selecting applies customerId', async () => {
    mockedFetch.mockResolvedValue({ data: [{ id: 'c-9', displayName: 'Acme Corp', taxId: '1790012345001' }] });
    renderFilters();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'acm' } });
    const option = await screen.findByRole('option', { name: /Acme Corp/ });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/customers', { query: { q: 'acm', pageSize: 10 } });
    fireEvent.click(option);
    expect(lastUrl().searchParams.get('customerId')).toBe('c-9');
  });

  it('shows an empty-result message and a search error without breaking the bar', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [] });
    renderFilters();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'zzz' } });
    expect(await screen.findByText('Ningún cliente coincide con esa búsqueda.')).toBeInTheDocument();
    mockedFetch.mockRejectedValueOnce(new Error('boom'));
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'zzzz' } });
    await waitFor(() => expect(screen.queryByText('Ningún cliente coincide con esa búsqueda.')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
  });

  it('shows the selected customer with Quitar, which clears only the customer', () => {
    renderFilters({ dateFrom: '2026-10-05', customerId: 'c-1', status: 'confirmed' }, true, 'Acme Corp');
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    const url = lastUrl();
    expect(url.searchParams.has('customerId')).toBe(false);
    expect(url.searchParams.get('status')).toBe('confirmed');
    expect(url.searchParams.get('dateFrom')).toBe('2026-10-05');
  });

  it('hides the customer filter without sales.customers.view', () => {
    renderFilters({}, false);
    expect(screen.queryByLabelText('Buscar cliente')).not.toBeInTheDocument();
  });

  it('"Restablecer filtros" only appears when something differs from the default and resets to today', () => {
    const { unmount } = render(bar());
    expect(screen.queryByText(/Restablecer filtros/)).not.toBeInTheDocument();
    unmount();
    render(bar({ dateFrom: '2026-10-01', status: 'pending' }));
    fireEvent.click(screen.getByText(/Restablecer filtros/));
    const url = lastUrl();
    expect(url.searchParams.get('dateFrom')).toBe(TODAY);
    expect(url.searchParams.has('status')).toBe(false);
  });

  it('Almacén lists only the given locations, with "Todos" only when allowed, and composes with the other filters', () => {
    const { unmount } = render(bar({ dateFrom: '2026-10-05', status: 'confirmed' }));
    const select = screen.getByLabelText('Almacén') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Todos los almacenes', 'Bodega Norte', 'Bodega Sur']);
    fireEvent.change(select, { target: { value: 'l-2' } });
    const url = lastUrl();
    expect(url.searchParams.get('locationId')).toBe('l-2');
    expect(url.searchParams.get('status')).toBe('confirmed');
    expect(url.searchParams.get('dateFrom')).toBe('2026-10-05');
    unmount();

    render(bar({ locationId: 'l-1' }, { locations: [LOCS[0]!], allowAll: false, defaultLocationId: 'l-1' }));
    const restricted = screen.getByLabelText('Almacén') as HTMLSelectElement;
    expect([...restricted.options].map((o) => o.textContent)).toEqual(['Bodega Norte']);
    expect(restricted.value).toBe('l-1');
    expect(screen.queryByText(/Restablecer filtros/)).not.toBeInTheDocument();
  });

  it('reset keeps the default Almacén (the single assigned one) instead of clearing it', () => {
    render(bar({ dateFrom: '2026-10-01', locationId: 'l-1' }, { locations: [LOCS[0]!], allowAll: false, defaultLocationId: 'l-1' }));
    fireEvent.click(screen.getByText(/Restablecer filtros/));
    const url = lastUrl();
    expect(url.searchParams.get('dateFrom')).toBe(TODAY);
    expect(url.searchParams.get('locationId')).toBe('l-1');
  });

  it('omits Tipo de documento and Cliente on screens where they do not apply (Aprobaciones / Devoluciones)', () => {
    render(bar({}, { noDocType: true, canSearchCustomers: false }));
    expect(screen.getByLabelText('Almacén')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tipo de documento')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Buscar cliente')).not.toBeInTheDocument();
  });

  it('keeps preserved params (e.g. orderId) on every navigation and honours the base path', () => {
    render(bar({}, { preserve: { orderId: 'o-1' } }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'pending' } });
    const url = lastUrl();
    expect(url.pathname).toBe('/sales');
    expect(url.searchParams.get('orderId')).toBe('o-1');
    expect(url.searchParams.get('status')).toBe('pending');
  });

  it('includeDates puts Desde/Hasta inside the same bar (one row with Almacén and Estado), with the same behaviour', () => {
    const full: HistoryFilterValues = { dateFrom: TODAY };
    render(
      <HistoryFilters
        basePath="/approvals"
        initial={full}
        today={TODAY}
        defaultLocationId={undefined}
        locations={LOCS}
        allowAllLocations
        statusOptions={STATUSES}
        includeDates
      />,
    );
    const bar = screen.getByLabelText('Almacén').closest('.grid') as HTMLElement;
    for (const label of ['Almacén', 'Estado', 'Desde', 'Hasta']) {
      expect(bar.contains(screen.getByLabelText(label))).toBe(true);
    }
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-05' } });
    fireEvent.blur(screen.getByLabelText('Desde'));
    fireEvent.blur(screen.getByLabelText('Desde'));
    expect(lastUrl().pathname).toBe('/approvals');
    expect(lastUrl().searchParams.get('dateFrom')).toBe('2026-10-05');
    expect(lastUrl().searchParams.has('dateTo')).toBe(false);
  });

  describe('typing a date by hand', () => {
    afterEach(() => vi.useRealTimers());

    it('does not navigate (and so does not reset the field) on every keystroke: the typed value stays', () => {
      vi.useFakeTimers();
      render(bar());
      const desde = screen.getByLabelText('Desde') as HTMLInputElement;
      fireEvent.change(desde, { target: { value: '2026-10-01' } });
      fireEvent.change(desde, { target: { value: '2026-10-13' } });
      expect(desde.value).toBe('2026-10-13');
      expect(pushMock).not.toHaveBeenCalled(); // still inside the pause
    });

    it('commits once, after a short pause, with the last complete date', () => {
      vi.useFakeTimers();
      render(bar());
      const desde = screen.getByLabelText('Desde');
      fireEvent.change(desde, { target: { value: '2026-10-01' } });
      fireEvent.change(desde, { target: { value: '2026-10-20' } });
      vi.advanceTimersByTime(800);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(lastUrl().searchParams.get('dateFrom')).toBe('2026-10-20');
    });

    it('a half-typed year (0002-10-13) is never committed; on blur the field returns to the last good value', () => {
      vi.useFakeTimers();
      render(bar({ dateFrom: '2026-10-05' }));
      const desde = screen.getByLabelText('Desde') as HTMLInputElement;
      fireEvent.change(desde, { target: { value: '0002-10-13' } });
      vi.advanceTimersByTime(2000);
      expect(pushMock).not.toHaveBeenCalled();
      fireEvent.blur(desde);
      expect(pushMock).not.toHaveBeenCalled();
      expect(desde.value).toBe('2026-10-05');
    });

    it('an empty value is committed only on blur / Enter, never mid-typing', () => {
      vi.useFakeTimers();
      render(bar({ dateFrom: '2026-10-05', dateTo: '2026-10-08' }));
      const hasta = screen.getByLabelText(/Hasta/);
      fireEvent.change(hasta, { target: { value: '' } });
      vi.advanceTimersByTime(2000);
      expect(pushMock).not.toHaveBeenCalled();
      fireEvent.keyDown(hasta, { key: 'Enter' });
      expect(lastUrl().searchParams.has('dateTo')).toBe(false);
    });
  });

  describe('Vendedor filter', () => {
    const SELLERS = [
      { value: 'u-1', label: 'QA Admin' },
      { value: 'u-2', label: 'QA Vendedor' },
    ];

    it('is not rendered unless sellerOptions are given', () => {
      render(bar());
      expect(screen.queryByLabelText('Vendedor')).not.toBeInTheDocument();
    });

    it('offers "Todos los vendedores" plus every given seller and navigates with placedByUserId', () => {
      pushMock.mockClear();
      render(bar({}, { sellers: SELLERS }));
      const select = screen.getByLabelText('Vendedor');
      expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Todos los vendedores', 'QA Admin', 'QA Vendedor']);
      fireEvent.change(select, { target: { value: 'u-2' } });
      expect(lastUrl().searchParams.get('placedByUserId')).toBe('u-2');
    });

    it('choosing "Todos" drops the param, and a chosen seller counts as a non-default filter', () => {
      pushMock.mockClear();
      render(bar({ placedByUserId: 'u-1' }, { sellers: SELLERS }));
      expect(screen.getByRole('button', { name: /restablecer filtros/i })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Vendedor'), { target: { value: '' } });
      expect(lastUrl().searchParams.has('placedByUserId')).toBe(false);
    });
  });

  describe('Sucursal + Almacén (HistoryLocationFilters)', () => {
    const WAREHOUSES = [
      { id: 'w-1', name: 'Matriz' },
      { id: 'w-2', name: 'Norte' },
    ];
    const LOCATIONS = [
      { id: 'l-1', name: 'General', warehouseId: 'w-1' },
      { id: 'l-2', name: 'Piso', warehouseId: 'w-1' },
      { id: 'l-3', name: 'General', warehouseId: 'w-2' },
    ];
    const renderLoc = (initial: Partial<HistoryFilterValues> = {}, allowAll = true) =>
      render(
        <HistoryLocationFilters
          basePath="/sales"
          initial={{ dateFrom: TODAY, ...initial }}
          warehouses={WAREHOUSES}
          locations={LOCATIONS}
          allowAll={allowAll}
        />,
      );
    const texts = (el: HTMLElement) => Array.from((el as HTMLSelectElement).options).map((o) => o.text);

    it('offers all sucursales and all almacenes when nothing is chosen (unrestricted)', () => {
      renderLoc();
      expect(texts(screen.getByLabelText('Sucursal'))).toEqual(['Todas las sucursales', 'Matriz', 'Norte']);
      expect(texts(screen.getByLabelText('Almacén'))).toEqual(['Todos los almacenes', 'General', 'Piso', 'General']);
    });

    it('a chosen Sucursal narrows the Almacén list to its own and navigates with warehouseId (Almacén back to "Todos")', () => {
      pushMock.mockClear();
      renderLoc({ warehouseId: 'w-1' });
      expect(texts(screen.getByLabelText('Almacén'))).toEqual(['Todos los almacenes', 'General', 'Piso']);
      fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w-2' } });
      expect(lastUrl().searchParams.get('warehouseId')).toBe('w-2');
      expect(lastUrl().searchParams.has('locationId')).toBe(false);
    });

    it('picking an Almacén keeps its Sucursal coherent in the URL', () => {
      pushMock.mockClear();
      renderLoc();
      fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'l-3' } });
      expect(lastUrl().searchParams.get('locationId')).toBe('l-3');
      expect(lastUrl().searchParams.get('warehouseId')).toBe('w-2');
    });

    it('a restricted user has no "Todas/Todos" options and changing Sucursal moves to its first Almacén', () => {
      pushMock.mockClear();
      renderLoc({ warehouseId: 'w-1', locationId: 'l-1' }, false);
      expect(texts(screen.getByLabelText('Sucursal'))).toEqual(['Matriz', 'Norte']);
      fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'w-2' } });
      expect(lastUrl().searchParams.get('locationId')).toBe('l-3');
    });
  });
});
