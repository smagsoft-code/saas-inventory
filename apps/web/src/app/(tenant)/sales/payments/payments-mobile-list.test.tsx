import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportLinks } from '../../../../components/export-icons';
import { buildPaymentsExportHref } from '../../../../lib/sales/payments-report';
import { PaymentsMobileList, type MobilePayment } from './payments-mobile-list';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const base: MobilePayment = {
  id: 'p1',
  orderId: 'o1',
  orderNumber: 'ORD-000001',
  paidAtLabel: '13/10/26, 10:00',
  customerName: 'Ana',
  paymentMethodLabel: 'Efectivo',
  amountLabel: '50.00 USD',
  sellerName: 'Luis',
  locationLabel: 'Matriz · General',
  documentLabel: 'Nota de venta',
  returnNote: null,
};

const OPTIONS = {
  paymentMethodOptions: [
    { value: 'cash', label: 'Efectivo' },
    { value: 'card', label: 'Tarjeta' },
  ],
  documentTypeOptions: [{ value: 'sales_note', label: 'Nota de venta' }],
  locationOptions: [{ value: 'loc-1', label: 'Matriz · General' }],
};

function renderList(overrides: Partial<React.ComponentProps<typeof PaymentsMobileList>> = {}) {
  return render(
    <PaymentsMobileList
      payments={[base]}
      empty="Sin pagos"
      count={1}
      params={{ dateFrom: '2026-10-13' }}
      sort="createdAt"
      dir="desc"
      {...OPTIONS}
      {...overrides}
    />,
  );
}

describe('PaymentsMobileList', () => {
  beforeEach(() => push.mockClear());

  it('shows the empty message when there are no payments', () => {
    renderList({ payments: [], count: 0 });
    expect(screen.getByText('Sin pagos')).toBeInTheDocument();
    expect(screen.getByText('0 registros encontrados')).toBeInTheDocument();
  });

  it('shows the card fields and the record count; the detail opens on tap with the link to the order', () => {
    renderList();
    expect(screen.getByText('ORD-000001')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('50.00 USD')).toBeInTheDocument();
    expect(screen.getByText('13/10/26, 10:00')).toBeInTheDocument();
    expect(screen.getByText('1 registro encontrado')).toBeInTheDocument();
    expect(screen.queryByText('Luis')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /ORD-000001/ }));
    expect(screen.getByText('Luis')).toBeInTheDocument();
    expect(screen.getByText('Nota de venta')).toBeInTheDocument();
    expect(screen.getByText('Matriz · General')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver pedido' })).toHaveAttribute('href', '/sales/o1');
  });

  it('puts the amount of an order with a return on a red background, with the note in the detail', () => {
    renderList({ payments: [{ ...base, returnNote: 'Orden con devolución' }] });
    expect(screen.getByText('50.00 USD')).toHaveClass('bg-red-600');
    fireEvent.click(screen.getByRole('button', { name: /ORD-000001/ }));
    expect(screen.getByText('Orden con devolución')).toBeInTheDocument();
  });

  it('leaves a normal amount without the red background', () => {
    renderList();
    expect(screen.getByText('50.00 USD')).not.toHaveClass('bg-red-600');
  });

  it('shows the active filters as removable chips, counted on the Filtros button', () => {
    renderList({ params: { dateFrom: '2026-10-13', paymentMethod: 'card', customerName: 'Ana' } });
    const chips = screen.getByLabelText('Filtros activos');
    expect(within(chips).getByText('Tarjeta')).toBeInTheDocument();
    expect(within(chips).getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Filtros\s*2$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Forma de pago' }));
    expect(push).toHaveBeenCalledWith('/sales/payments?dateFrom=2026-10-13&customerName=Ana', { scroll: false });
  });

  it('applies the panel filters and sorting through the URL, keeping the date range', () => {
    renderList();
    fireEvent.change(screen.getByLabelText('Ordenar'), { target: { value: 'amount:desc' } });
    expect(push).toHaveBeenLastCalledWith('/sales/payments?dateFrom=2026-10-13&sort=amount&dir=desc', { scroll: false });

    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Forma de pago'), { target: { value: 'cash' } });
    fireEvent.change(within(dialog).getByLabelText('Monto'), { target: { value: '50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }));
    expect(push).toHaveBeenLastCalledWith('/sales/payments?dateFrom=2026-10-13&amount=50&paymentMethod=cash', { scroll: false });
  });
});

describe('payments export links', () => {
  it('builds hrefs that carry the on-screen filters and no paging', () => {
    const href = buildPaymentsExportHref({ dateFrom: '2026-10-13', paymentMethod: 'card', sort: 'amount', dir: 'asc', page: 3 }, 'xlsx');
    expect(href).toContain('/api/v1/reports/payments/export?');
    expect(href).toContain('format=xlsx');
    expect(href).toContain('dateFrom=2026-10-13');
    expect(href).toContain('paymentMethod=card');
    expect(href).not.toContain('page=');
  });

  it('renders icon-only Excel and PDF links with accessible names, like the Kardex', () => {
    render(<ExportLinks excelHref="/a?format=xlsx" pdfHref="/a?format=pdf" />);
    expect(screen.queryByText('Exportar a Excel')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Exportar a Excel' })).toHaveAttribute('href', '/a?format=xlsx');
    expect(screen.getByRole('link', { name: 'Exportar a PDF' })).toHaveAttribute('href', '/a?format=pdf');
  });
});
