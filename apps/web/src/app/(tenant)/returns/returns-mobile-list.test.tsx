import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnsMobileList, type MobileReturn } from './returns-mobile-list';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const base: MobileReturn = {
  id: 'r1',
  returnNumber: 'DEV-001',
  createdAtLabel: '26/10/26, 10:00',
  orderId: 'o1',
  orderLabel: 'ORD-000049',
  locationLabel: 'Sucursal Principal · Almacén Principal',
  userName: 'Ana',
  requested: true,
  products: [
    { id: 'i1', label: 'Peinadora clásica', quantity: 2 },
    { id: 'i2', label: 'Silla', quantity: 1 },
    { id: 'i3', label: 'Mesa', quantity: 1 },
  ],
  reason: 'Llegó dañada',
  statusLabel: 'Solicitada',
  statusTone: 'warning',
};

const STATUSES = [
  { value: 'requested', label: 'Solicitada' },
  { value: 'resolved', label: 'Resuelta' },
];
const LOCATIONS = [
  { value: 'loc-1', label: 'Sucursal Principal · Almacén Principal' },
  { value: 'loc-2', label: 'Sucursal Norte · General' },
];

function renderList(overrides: Partial<React.ComponentProps<typeof ReturnsMobileList>> = {}) {
  return render(
    <ReturnsMobileList
      returns={[base]}
      count={1}
      params={{ dateFrom: '2026-10-26' }}
      statusOptions={STATUSES}
      locationOptions={LOCATIONS}
      allowAllLocations
      defaultLocationId={undefined}
      canViewOrders
      empty="Sin devoluciones"
      {...overrides}
    />,
  );
}

describe('ReturnsMobileList', () => {
  beforeEach(() => push.mockClear());

  it('puts the heading and the Filtros button on one row', () => {
    renderList();
    const heading = screen.getByRole('heading', { name: 'Historial de devoluciones' });
    expect(heading.parentElement).toContainElement(screen.getByRole('button', { name: /^Filtros/ }));
  });

  it('shows the empty message and a zero count', () => {
    renderList({ returns: [], count: 0 });
    expect(screen.getByText('Sin devoluciones')).toBeInTheDocument();
    expect(screen.getByText('0 registros encontrados')).toBeInTheDocument();
  });

  it('shows number, date, first product, reason under it and estado; the detail opens on tap', () => {
    renderList();
    expect(screen.getByText('DEV-001')).toBeInTheDocument();
    expect(screen.getByText('26/10/26, 10:00')).toBeInTheDocument();
    expect(screen.getByText('Peinadora clásica')).toBeInTheDocument();
    expect(screen.getByText('+2 más')).toBeInTheDocument();
    expect(screen.getByText('Llegó dañada')).toBeInTheDocument();
    expect(screen.getByText('Solicitada')).toBeInTheDocument();
    expect(screen.queryByText('Sucursal Principal · Almacén Principal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /DEV-001/ }));
    expect(screen.getByText('ORD-000049')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('solicitó')).toBeInTheDocument();
    expect(screen.getByText('Sucursal Principal · Almacén Principal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver devolución' })).toHaveAttribute('href', '/returns/r1');
    expect(screen.getByRole('link', { name: 'Ver pedido' })).toHaveAttribute('href', '/sales/o1');
  });

  it('hides the order link when the caller cannot view orders', () => {
    renderList({ canViewOrders: false });
    fireEvent.click(screen.getByRole('button', { name: /DEV-001/ }));
    expect(screen.queryByRole('link', { name: 'Ver pedido' })).toBeNull();
  });

  it('counts the active filters as chips; removing one keeps the dates', () => {
    renderList({ params: { dateFrom: '2026-10-26', status: 'resolved', locationId: 'loc-2' } });
    const chips = screen.getByLabelText('Filtros activos');
    expect(within(chips).getByText('Resuelta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Filtros\s*2$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Estado' }));
    expect(push).toHaveBeenCalledWith('/returns?dateFrom=2026-10-26&locationId=loc-2', { scroll: false });
  });

  it('applies the panel filters through the URL', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Estado'), { target: { value: 'resolved' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }));
    expect(push).toHaveBeenCalledWith('/returns?dateFrom=2026-10-26&status=resolved', { scroll: false });
  });
});
