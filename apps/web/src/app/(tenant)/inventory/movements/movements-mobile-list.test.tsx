import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MovementsMobileList, type MobileMovement } from './movements-mobile-list';

const base: MobileMovement = {
  id: 'm1',
  whenLabel: '2026-10-22 10:00',
  typeLabel: 'Venta',
  quantity: -2,
  balanceAfter: 8,
  locationLabel: 'Sucursal Centro — General',
  referenceLabel: 'Venta #ORD-000046',
  userLabel: 'Admin',
};

describe('MovementsMobileList', () => {
  it('shows every column of the table with the document name, never an id', () => {
    render(<MovementsMobileList movements={[base]} />);
    expect(screen.getByText('Venta #ORD-000046')).toBeTruthy();
    expect(screen.getByText('Sucursal Centro — General')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByText('Venta')).toBeTruthy();
    expect(screen.getByText('-2')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('prefixes a positive quantity with +', () => {
    render(<MovementsMobileList movements={[{ ...base, quantity: 5 }]} />);
    expect(screen.getByText('+5')).toBeTruthy();
  });
});
