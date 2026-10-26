import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderDetailMobile, type MobileOrderDetail } from './order-detail-mobile';

const detail: MobileOrderDetail = {
  orderNumber: 'ORD-000050',
  statusLabel: 'Pendiente',
  statusTone: 'warning',
  subtitle: 'Nota de venta · General',
  customer: {
    name: 'Hector Yepez',
    href: '/customers/c1',
    taxId: '1003798541',
    email: 'hola@gmail.com',
    phone: '0999874512',
    address: 'Quito',
    location: 'General',
    warehouse: 'Sucursal Norte QA',
    createdLabel: '26/10/2026, 11:12:10',
  },
  items: [
    {
      id: 'i1',
      sku: 'APA-001',
      productName: 'Aparador grande dos niveles',
      belowMinimum: true,
      movementsHref: '/inventory/movements?productVariantId=v1',
      quantity: 1,
      unitPrice: '110.00',
      lineTotal: '110.00',
    },
  ],
  totals: { subtotal: '110.00', discount: '0.00', tax: '0.00', total: '110.00', currency: 'USD' },
};

describe('OrderDetailMobile', () => {
  it('shows the customer data the desktop shows, with the name linking to the customer', () => {
    render(<OrderDetailMobile detail={detail} />);
    expect(screen.getByRole('link', { name: 'Hector Yepez' }).getAttribute('href')).toBe('/customers/c1');
    for (const text of ['1003798541', 'hola@gmail.com', '0999874512', 'Quito', 'General · Sucursal Norte QA', '26/10/2026, 11:12:10']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.queryByText('Estado de la factura')).toBeNull();
  });

  it('lists each line with sku, below-minimum flag, quantity, prices and the movements link, then the totals', () => {
    render(<OrderDetailMobile detail={detail} />);
    expect(screen.getByText('APA-001')).toBeTruthy();
    expect(screen.getByText('bajo el mínimo')).toBeTruthy();
    expect(screen.getByText('Aparador grande dos niveles')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'movimientos' }).getAttribute('href')).toBe('/inventory/movements?productVariantId=v1');
    expect(screen.getByText('1 artículo')).toBeTruthy();
    expect(screen.getByText('Descuento (informativo)')).toBeTruthy();
    expect(screen.getByText('Impuesto')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();
  });
});
