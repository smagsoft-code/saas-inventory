import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransferDetailMobile, type MobileTransferDetail } from './transfer-detail-mobile';

const detail: MobileTransferDetail = {
  code: 'SUC-001',
  status: 'dispatched',
  statusLabel: 'Despachada',
  statusTone: 'warning',
  source: { name: 'General', warehouse: 'Sucursal Centro' },
  destination: { name: 'Almacén Principal', warehouse: 'Sucursal Norte' },
  people: [{ label: 'Solicitada por', value: 'Ana' }],
  notes: 'Frágil',
  events: [{ label: 'Creada', value: '22/10/2026 10:00' }],
  items: [
    {
      id: 'i1',
      label: 'Peinadora — PEI-002',
      href: '/inventory/movements?productVariantId=v1',
      requested: 5,
      dispatched: 4,
      received: 1,
      inTransit: 3,
    },
    { id: 'i2', label: 'Silla', requested: 2, dispatched: 2, received: 0, inTransit: 2 },
  ],
};

describe('TransferDetailMobile', () => {
  it('shows the summary: code, estado, origin and destination, people, events, notes and the timeline', () => {
    render(<TransferDetailMobile detail={detail} />);
    expect(screen.getByText('SUC-001')).toBeTruthy();
    expect(screen.getByText('Despachada')).toBeTruthy();
    expect(screen.getByText('Sucursal Centro')).toBeTruthy();
    expect(screen.getByText('Sucursal Norte')).toBeTruthy();
    expect(screen.getByText('Solicitada por')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('22/10/2026 10:00')).toBeTruthy();
    expect(screen.getByText('Frágil')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Avance de la transferencia' }).querySelector('[aria-current="step"]')?.textContent).toContain('Despachado');
  });

  it('lists each product with its four quantities; only inventory viewers get the movements link', () => {
    render(<TransferDetailMobile detail={detail} />);
    expect(screen.getByText('Productos (2)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Peinadora — PEI-002' }).getAttribute('href')).toBe(
      '/inventory/movements?productVariantId=v1',
    );
    expect(screen.queryByRole('link', { name: 'Silla' })).toBeNull();
    expect(screen.getAllByText('Solicitado')).toHaveLength(2);
    expect(screen.getAllByText('En tránsito')).toHaveLength(2);
  });
});
