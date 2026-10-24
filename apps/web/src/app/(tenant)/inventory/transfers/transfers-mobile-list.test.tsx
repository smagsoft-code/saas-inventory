import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { timelineStep, TransfersMobileList, type MobileTransfer } from './transfers-mobile-list';

const transfer: MobileTransfer = {
  id: 't1',
  code: 'SUC-001',
  status: 'dispatched',
  statusLabel: 'Despachada',
  statusTone: 'warning',
  sourceLabel: 'Centro',
  destinationLabel: 'Norte',
  lineCount: 3,
  inTransit: 7,
  createdLabel: '22/10/2026',
};

describe('TransfersMobileList', () => {
  it('shows the table data (Productos, not Líneas) and links to the detail', () => {
    render(<TransfersMobileList transfers={[transfer]} />);
    expect(screen.getByText('SUC-001')).toBeTruthy();
    expect(screen.getByText('Despachada')).toBeTruthy();
    expect(screen.getByText('Centro')).toBeTruthy();
    expect(screen.getByText('Norte')).toBeTruthy();
    expect(screen.getByText('Productos')).toBeTruthy();
    expect(screen.queryByText('Líneas')).toBeNull();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe(
      '/inventory/transfers/t1',
    );
  });

  it('draws the Creado → Aprobado → Despachado → Recibido timeline up to the current step', () => {
    render(<TransfersMobileList transfers={[transfer]} />);
    for (const step of ['Creado', 'Aprobado', 'Despachado', 'Recibido'])
      expect(screen.getByText(step)).toBeTruthy();
    expect(screen.getByText('Despachado').closest('li')?.getAttribute('aria-current')).toBe('step');
  });

  it('maps every status to a step and hides the timeline when cancelled', () => {
    expect(
      [
        'draft',
        'approved',
        'preparing',
        'dispatched',
        'partially_received',
        'received',
        'cancelled',
      ].map(timelineStep),
    ).toEqual([0, 1, 1, 2, 2, 3, -1]);
    render(<TransfersMobileList transfers={[{ ...transfer, status: 'cancelled' }]} />);
    expect(screen.queryByText('Creado')).toBeNull();
  });
});
