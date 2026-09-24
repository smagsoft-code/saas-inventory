import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KardexStockByLocation } from './kardex-stock-by-location';

describe('KardexStockByLocation', () => {
  afterEach(() => cleanup());

  it('shows an empty state when the variant has no balance anywhere', () => {
    render(<KardexStockByLocation rows={[]} />);
    expect(screen.getByText('Sin existencias registradas en ninguna sucursal')).toBeInTheDocument();
  });

  it('renders one row per location with físico and disponible', () => {
    render(
      <KardexStockByLocation
        rows={[
          { locationId: 'loc-1', locationName: 'Almacén Principal', warehouseName: 'Sucursal Centro', stockPhysical: 10, stockAvailable: 8 },
          { locationId: 'loc-2', locationName: 'Almacén Norte', warehouseName: 'Sucursal Norte', stockPhysical: 5 },
        ]}
      />,
    );
    expect(screen.getByText('Sucursal Centro')).toBeInTheDocument();
    expect(screen.getByText('Almacén Principal')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    // stockAvailable omitted (no pricing/scope concern here, just absence) falls back to em dash.
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
