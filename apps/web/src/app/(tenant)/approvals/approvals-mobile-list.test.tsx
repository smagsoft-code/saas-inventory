import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsMobileList, type MobileApproval } from './approvals-mobile-list';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const base: MobileApproval = {
  id: 'a1',
  orderId: 'o1',
  orderNumber: 'ORD-000049',
  requestedAtLabel: '23/10/26, 21:05',
  productName: 'Peinadora clásica',
  locationLabel: 'Sucursal Principal · Almacén Principal',
  requestedPriceLabel: '90.00',
  discountLabel: '10.00',
  reason: 'Descuento solicitado por QA Admin.',
  statusLabel: 'Pendiente',
  statusTone: 'warning',
};

const STATUSES = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'approved', label: 'Aprobada' },
];
const LOCATIONS = [
  { value: 'loc-1', label: 'Sucursal Principal · Almacén Principal' },
  { value: 'loc-2', label: 'Sucursal Norte · General' },
];

function renderList(overrides: Partial<React.ComponentProps<typeof ApprovalsMobileList>> = {}) {
  return render(
    <ApprovalsMobileList
      approvals={[base]}
      count={1}
      params={{ dateFrom: '2026-10-23' }}
      statusOptions={STATUSES}
      locationOptions={LOCATIONS}
      allowAllLocations
      defaultLocationId={undefined}
      empty="Sin solicitudes"
      {...overrides}
    />,
  );
}

describe('ApprovalsMobileList', () => {
  beforeEach(() => push.mockClear());

  it('shows the empty message and a zero count when there is nothing', () => {
    renderList({ approvals: [], count: 0 });
    expect(screen.getByText('Sin solicitudes')).toBeInTheDocument();
    expect(screen.getByText('0 registros encontrados')).toBeInTheDocument();
  });

  it('shows the card (order, date, price, product, estado) and opens the detail with its links', () => {
    renderList();
    expect(screen.getByText('ORD-000049')).toBeInTheDocument();
    expect(screen.getByText('23/10/26, 21:05')).toBeInTheDocument();
    expect(screen.getByText('Peinadora clásica')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('1 registro encontrado')).toBeInTheDocument();
    expect(screen.queryByText('Descuento solicitado por QA Admin.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /ORD-000049/ }));
    expect(screen.getByText('Descuento solicitado por QA Admin.')).toBeInTheDocument();
    expect(screen.getByText('10.00')).toBeInTheDocument();
    expect(screen.getByText('Sucursal Principal · Almacén Principal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver solicitud' })).toHaveAttribute('href', '/approvals/a1');
    expect(screen.getByRole('link', { name: 'Ver pedido' })).toHaveAttribute('href', '/sales/o1');
  });

  it('counts and shows the active filters as chips; removing one navigates keeping the dates', () => {
    renderList({ params: { dateFrom: '2026-10-23', status: 'pending', locationId: 'loc-2' } });
    const chips = screen.getByLabelText('Filtros activos');
    expect(within(chips).getByText('Pendiente')).toBeInTheDocument();
    expect(within(chips).getByText('Sucursal Norte · General')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Filtros\s*2$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Estado' }));
    expect(push).toHaveBeenCalledWith('/approvals?dateFrom=2026-10-23&locationId=loc-2', { scroll: false });
  });

  it('does not count the almacén the user is scoped to by default as a filter', () => {
    renderList({ params: { dateFrom: '2026-10-23', locationId: 'loc-1' }, allowAllLocations: false, defaultLocationId: 'loc-1' });
    expect(screen.queryByLabelText('Filtros activos')).toBeNull();
    expect(screen.getByRole('button', { name: /^Filtros$/ })).toBeInTheDocument();
  });

  it('applies the panel filters through the URL', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Estado'), { target: { value: 'approved' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }));
    expect(push).toHaveBeenCalledWith('/approvals?dateFrom=2026-10-23&status=approved', { scroll: false });
  });
});
