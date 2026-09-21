import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationScopePicker, type LocationScopeOption } from './location-scope-picker';

const LOCATIONS: LocationScopeOption[] = [
  { id: 'l1', name: 'Zona A', warehouseId: 'w1', warehouseName: 'Almacén Principal', status: 'active' },
  { id: 'l2', name: 'Zona B', warehouseId: 'w1', warehouseName: 'Almacén Principal', status: 'active' },
  { id: 'l3', name: 'Zona C', warehouseId: 'w2', warehouseName: 'Almacén Norte', status: 'active' },
];

describe('LocationScopePicker', () => {
  afterEach(() => cleanup());

  it('groups locations under their warehouse name as a heading (§3 del bloque)', () => {
    render(
      <LocationScopePicker locations={LOCATIONS} restricted={true} onRestrictedChange={vi.fn()} selected={new Set()} onToggle={vi.fn()} />,
    );
    const principal = screen.getByText('Almacén Principal').closest('fieldset')!;
    expect(within(principal).getByText('Zona A')).toBeInTheDocument();
    expect(within(principal).getByText('Zona B')).toBeInTheDocument();
    expect(within(principal).queryByText('Zona C')).not.toBeInTheDocument();

    const norte = screen.getByText('Almacén Norte').closest('fieldset')!;
    expect(within(norte).getByText('Zona C')).toBeInTheDocument();
  });

  it('hides the location groups when not restricted', () => {
    render(
      <LocationScopePicker locations={LOCATIONS} restricted={false} onRestrictedChange={vi.fn()} selected={new Set()} onToggle={vi.fn()} />,
    );
    expect(screen.queryByText('Almacén Principal')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('calls onToggle with the location id when a checkbox is clicked', () => {
    const onToggle = vi.fn();
    render(
      <LocationScopePicker locations={LOCATIONS} restricted={true} onRestrictedChange={vi.fn()} selected={new Set()} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /zona a/i }));
    expect(onToggle).toHaveBeenCalledWith('l1');
  });

  it('calls onRestrictedChange when switching radio mode', () => {
    const onRestrictedChange = vi.fn();
    render(
      <LocationScopePicker locations={LOCATIONS} restricted={false} onRestrictedChange={onRestrictedChange} selected={new Set()} onToggle={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText(/asignar almacenes\/ubicaciones/i));
    expect(onRestrictedChange).toHaveBeenCalledWith(true);
  });

  it('ADR-0035: the "no assignment" option explains it denies operation everywhere, not "unrestricted"', () => {
    render(
      <LocationScopePicker locations={LOCATIONS} restricted={false} onRestrictedChange={vi.fn()} selected={new Set()} onToggle={vi.fn()} />,
    );
    expect(screen.getByText(/no podrá vender, ajustar inventario ni operar transferencias/i)).toBeInTheDocument();
  });
});
