import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransfersMobileList, type MobileTransfer } from './transfers-mobile-list';

const transfer: MobileTransfer = {
  id: 't1',
  code: 'SUC-001',
  statusLabel: 'Despachada',
  statusTone: 'warning',
  sourceLabel: 'Centro',
  destinationLabel: 'Norte',
  lineCount: 3,
  inTransit: 7,
  createdLabel: '22/10/2026',
};

describe('TransfersMobileList', () => {
  it('shows the table columns and links to the detail', () => {
    render(<TransfersMobileList transfers={[transfer]} />);
    expect(screen.getByText('SUC-001')).toBeTruthy();
    expect(screen.getByText('Despachada')).toBeTruthy();
    expect(screen.getByText('Centro')).toBeTruthy();
    expect(screen.getByText('Norte')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('/inventory/transfers/t1');
  });
});
