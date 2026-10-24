import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesTableHead, type SalesSortColumn } from './sales-table-head';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const DOC = [{ value: 'invoice', label: 'Factura' }, { value: 'sales_note', label: 'Nota de venta' }];
const LOC = [{ value: 'l1', label: 'Matriz · General' }];
const STATUS = [{ value: 'pending', label: 'Pendiente' }, { value: 'confirmed', label: 'Confirmado' }, { value: 'cancelled', label: 'Cancelado' }];
const NOTIF = [{ value: 'none', label: 'Sin notificación' }, { value: 'pending', label: 'En cola' }];

function renderHead(params: Record<string, string> = { dateFrom: '2026-10-01' }, sort: SalesSortColumn = 'createdAt', dir: 'asc' | 'desc' = 'desc') {
  return render(
    <table>
      <SalesTableHead params={params} sort={sort} dir={dir} documentTypeOptions={DOC} locationOptions={LOC} statusOptions={STATUS} notificationOptions={NOTIF} />
    </table>,
  );
}

const lastUrl = (): URL => new URL(String(pushMock.mock.calls.at(-1)![0]), 'http://x');

describe('SalesTableHead', () => {
  beforeEach(() => pushMock.mockClear());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the column titles ("Fecha", not "Creado") and a filter cell under each filterable one', () => {
    renderHead();
    for (const title of ['Pedido', 'Fecha', 'Cliente', 'Vendedor', 'Documento', 'Almacén', 'Estado', 'Notificación', 'Total']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText('Creado')).not.toBeInTheDocument();
    for (const label of ['pedido', 'cliente', 'vendedor', 'total']) {
      expect(screen.getByLabelText(`Filtrar por ${label}`).tagName).toBe('INPUT');
    }
    for (const label of ['documento', 'almacén', 'estado', 'notificación']) {
      expect(screen.getByLabelText(`Filtrar por ${label}`).tagName).toBe('SELECT');
    }
  });

  it('Estado offers only Pendiente / Confirmado / Cancelado (no borrador, no completado)', () => {
    renderHead();
    const options = Array.from((screen.getByLabelText('Filtrar por estado') as HTMLSelectElement).options).map((o) => o.text);
    expect(options).toEqual(['Todos', 'Pendiente', 'Confirmado', 'Cancelado']);
  });

  it('shows ↓ on the active default sort (Fecha, newest first) and toggles it to ascending', () => {
    renderHead();
    expect(screen.getByRole('button', { name: 'Ordenar por Fecha' })).toHaveTextContent('↓');
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por Fecha' }));
    expect(lastUrl().searchParams.get('sort')).toBe('createdAt');
    expect(lastUrl().searchParams.get('dir')).toBe('asc');
  });

  it('flipping Fecha back to descending drops the (default) sort params', () => {
    renderHead({ dateFrom: '2026-10-01', sort: 'createdAt', dir: 'asc' }, 'createdAt', 'asc');
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por Fecha' }));
    expect(lastUrl().searchParams.has('sort')).toBe(false);
    expect(lastUrl().searchParams.has('dir')).toBe(false);
  });

  it('clicking another column sorts it ascending first, then toggles', () => {
    const { unmount } = renderHead();
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por Total' }));
    expect(lastUrl().searchParams.get('sort')).toBe('total');
    expect(lastUrl().searchParams.get('dir')).toBe('asc');
    unmount();
    renderHead({ dateFrom: '2026-10-01', sort: 'total', dir: 'asc' }, 'total', 'asc');
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por Total' }));
    expect(lastUrl().searchParams.get('dir')).toBe('desc');
  });

  it('a dropdown filter navigates at once, keeping the other params and dropping the page', () => {
    renderHead({ dateFrom: '2026-10-01', customerName: 'ana', page: '3' });
    fireEvent.change(screen.getByLabelText('Filtrar por documento'), { target: { value: 'invoice' } });
    const url = lastUrl();
    expect(url.pathname).toBe('/sales');
    expect(url.searchParams.get('documentType')).toBe('invoice');
    expect(url.searchParams.get('customerName')).toBe('ana');
    expect(url.searchParams.get('dateFrom')).toBe('2026-10-01');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('a text filter waits for typing to pause (debounced) instead of navigating on every keystroke', () => {
    vi.useFakeTimers();
    renderHead();
    const input = screen.getByLabelText('Filtrar por cliente');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'an' } });
    fireEvent.change(input, { target: { value: 'ana' } });
    expect(pushMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(lastUrl().searchParams.get('customerName')).toBe('ana');
  });

  it('Enter applies a text filter immediately; clearing it removes the param', () => {
    renderHead({ dateFrom: '2026-10-01', total: '200' });
    const input = screen.getByLabelText('Filtrar por total');
    expect(input).toHaveValue('200');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lastUrl().searchParams.has('total')).toBe(false);
  });

  it('Estado shows the confirmed default selected, and "Todos" is sent as an explicit status=all', () => {
    renderHead({ dateFrom: '2026-10-01', status: 'confirmed' });
    const select = screen.getByLabelText('Filtrar por estado') as HTMLSelectElement;
    expect(select.value).toBe('confirmed');
    fireEvent.change(select, { target: { value: '' } });
    expect(lastUrl().searchParams.get('status')).toBe('all'); // never "no param" — that means the default
  });

  it('with status=all the select shows "Todos"; picking a status sends it', () => {
    renderHead({ dateFrom: '2026-10-01', status: 'all' });
    const select = screen.getByLabelText('Filtrar por estado') as HTMLSelectElement;
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'pending' } });
    expect(lastUrl().searchParams.get('status')).toBe('pending');
  });
});
