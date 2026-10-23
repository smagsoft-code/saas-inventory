import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesMobileList, type MobileOrder } from './sales-mobile-list';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const ORDERS: MobileOrder[] = [
  {
    id: 'o1',
    orderNumber: 'ORD-000042',
    createdAtLabel: '13/10/26, 21:29',
    customerName: 'Hector Yepez',
    sellerName: 'QA Vendedor',
    documentLabel: 'Factura',
    locationLabel: 'Sucursal Principal QA · Almacén Principal',
    statusLabel: 'Confirmado',
    statusTone: 'success',
    notificationLabel: 'En cola',
    notificationTone: 'warning',
    totalLabel: '142.00 USD',
  },
  {
    id: 'o2',
    orderNumber: 'ORD-000040',
    createdAtLabel: '8/10/26, 14:49',
    customerName: 'Nadia Jaime',
    sellerName: 'QA Admin',
    documentLabel: 'Nota de venta',
    locationLabel: 'Sucursal Principal QA · Almacén Principal',
    statusLabel: 'Pendiente',
    statusTone: 'warning',
    notificationLabel: null,
    notificationTone: 'neutral',
    totalLabel: '15.00 USD',
  },
];

const OPTS = {
  documentTypeOptions: [{ value: 'invoice', label: 'Factura' }, { value: 'sales_note', label: 'Nota de venta' }],
  locationOptions: [{ value: 'l1', label: 'Sucursal Principal QA · Almacén Principal' }],
  statusOptions: [{ value: 'pending', label: 'Pendiente' }, { value: 'confirmed', label: 'Confirmado' }, { value: 'cancelled', label: 'Cancelado' }],
  notificationOptions: [{ value: 'none', label: 'Sin notificación' }, { value: 'pending', label: 'En cola' }],
};

function renderList(params: Record<string, string> = { dateFrom: '2026-10-01' }, orders = ORDERS, count = orders.length) {
  return render(<SalesMobileList orders={orders} count={count} params={params} sort="createdAt" dir="desc" {...OPTS} />);
}
const lastUrl = (): URL => new URL(String(pushMock.mock.calls.at(-1)![0]), 'http://x');

describe('SalesMobileList', () => {
  beforeEach(() => pushMock.mockClear());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the record count and one card per order with number, date, customer, total and badges', () => {
    renderList();
    expect(screen.getByText('2 registros encontrados')).toBeInTheDocument();
    expect(screen.getByText('ORD-000042')).toBeInTheDocument();
    expect(screen.getByText('13/10/26, 21:29')).toBeInTheDocument();
    expect(screen.getByText('Hector Yepez')).toBeInTheDocument();
    expect(screen.getByText('142.00 USD')).toBeInTheDocument();
    expect(screen.getByText('Confirmado')).toBeInTheDocument();
    expect(screen.getByText('En cola')).toBeInTheDocument();
  });

  it('shows no notification badge when the order has none (nothing is invented)', () => {
    renderList({ dateFrom: '2026-10-01' }, [ORDERS[1]!]);
    expect(screen.queryByText('En cola')).not.toBeInTheDocument();
    expect(screen.queryByText('Sin notificación')).not.toBeInTheDocument();
  });

  it('tapping a card expands the detail: vendedor, tipo de documento, sucursal y almacén, and "Ver pedido"', () => {
    renderList();
    expect(screen.queryByText('Vendedor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ORD-000042'));
    expect(screen.getByText('QA Vendedor')).toBeInTheDocument();
    expect(screen.getByText('Factura')).toBeInTheDocument();
    expect(screen.getByText('Sucursal Principal QA · Almacén Principal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver pedido' })).toHaveAttribute('href', '/sales/o1');
    // tapping another card collapses the first
    fireEvent.click(screen.getByText('ORD-000040'));
    expect(screen.queryByText('QA Vendedor')).not.toBeInTheDocument();
    expect(screen.getByText('QA Admin')).toBeInTheDocument();
  });

  it('the search box waits for typing to pause, then searches pedido/cliente/vendedor with q', () => {
    vi.useFakeTimers();
    renderList();
    const box = screen.getByLabelText('Buscar por pedido, cliente o vendedor');
    fireEvent.change(box, { target: { value: 'ha' } });
    fireEvent.change(box, { target: { value: 'hector' } });
    expect(pushMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(lastUrl().searchParams.get('q')).toBe('hector');
    expect(lastUrl().searchParams.get('dateFrom')).toBe('2026-10-01');
  });

  it('shows active filters as chips with their readable value, and × removes just that one', () => {
    renderList({ dateFrom: '2026-10-01', documentType: 'invoice', status: 'confirmed', customerName: 'ana' });
    expect(screen.getByRole('button', { name: /Filtros/ })).toHaveTextContent('3'); // 3 active filters
    const chips = screen.getByLabelText('Filtros activos');
    expect(within(chips).getByText('Factura')).toBeInTheDocument();
    expect(within(chips).getByText('Confirmado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Documento' }));
    const url = lastUrl();
    expect(url.searchParams.has('documentType')).toBe(false);
    expect(url.searchParams.get('status')).toBe('confirmed');
    expect(url.searchParams.get('customerName')).toBe('ana');
  });

  it('the Filtros panel applies several filters at once and drops the page', () => {
    renderList({ dateFrom: '2026-10-01', page: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    const dialog = screen.getByRole('dialog', { name: 'Filtros' });
    fireEvent.change(within(dialog).getByLabelText('Estado'), { target: { value: 'pending' } });
    fireEvent.change(within(dialog).getByLabelText('Cliente'), { target: { value: 'nadia' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }));
    const url = lastUrl();
    expect(url.searchParams.get('status')).toBe('pending');
    expect(url.searchParams.get('customerName')).toBe('nadia');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('"Limpiar" removes every panel filter but keeps the dates', () => {
    renderList({ dateFrom: '2026-10-01', status: 'pending', total: '100' });
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Limpiar' }));
    const url = lastUrl();
    expect(url.searchParams.get('dateFrom')).toBe('2026-10-01');
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('total')).toBe(false);
  });

  it('sorting offers recent-first (default, no params), oldest-first and total/customer orders', () => {
    renderList();
    const select = screen.getByLabelText('Ordenar') as HTMLSelectElement;
    expect(select.value).toBe('createdAt:desc');
    fireEvent.change(select, { target: { value: 'total:desc' } });
    expect(lastUrl().searchParams.get('sort')).toBe('total');
    expect(lastUrl().searchParams.get('dir')).toBe('desc');
    fireEvent.change(select, { target: { value: 'createdAt:desc' } });
    expect(lastUrl().searchParams.has('sort')).toBe(false);
  });

  it('shows an honest empty message', () => {
    renderList({ dateFrom: '2026-10-01', status: 'cancelled' }, [], 0);
    expect(screen.getByText('0 registros encontrados')).toBeInTheDocument();
    expect(screen.getByText('Ningún pedido coincide con estos filtros.')).toBeInTheDocument();
  });
});
