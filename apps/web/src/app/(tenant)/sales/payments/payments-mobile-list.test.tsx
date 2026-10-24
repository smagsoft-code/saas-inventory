import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExportLinks } from '../../../../components/export-icons';
import { buildPaymentsExportHref } from '../../../../lib/sales/payments-report';
import { PaymentsMobileList, type MobilePayment } from './payments-mobile-list';

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

describe('PaymentsMobileList', () => {
  it('shows the empty message when there are no payments', () => {
    render(<PaymentsMobileList payments={[]} empty="Sin pagos" />);
    expect(screen.getByText('Sin pagos')).toBeInTheDocument();
  });

  it('renders the six report fields and links the order', () => {
    render(<PaymentsMobileList payments={[base]} empty="x" />);
    expect(screen.getByRole('link', { name: 'ORD-000001' })).toHaveAttribute('href', '/sales/o1');
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('50.00 USD')).toBeInTheDocument();
    expect(screen.getByText(/Luis/)).toBeInTheDocument();
    expect(screen.getByText('13/10/26, 10:00')).toBeInTheDocument();
  });

  it('puts the amount of an order with a return on a red background, with the note', () => {
    render(<PaymentsMobileList payments={[{ ...base, returnNote: 'Orden con devolución' }]} empty="x" />);
    expect(screen.getByText('50.00 USD')).toHaveClass('bg-red-600');
    expect(screen.getAllByText('Orden con devolución').length).toBeGreaterThan(0);
  });

  it('leaves a normal amount without the red background', () => {
    render(<PaymentsMobileList payments={[base]} empty="x" />);
    expect(screen.getByText('50.00 USD')).not.toHaveClass('bg-red-600');
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
