import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getKardex } from '../../../lib/inventory/kardex';
import type { KardexResponse, KardexRow } from '../../../lib/types/kardex';
import { KardexAllLocations } from './kardex-all-locations';
import { KardexStockByLocation } from './kardex-stock-by-location';
import { KardexTable } from './kardex-table';

vi.mock('../../../lib/use-is-mobile', () => ({ useIsMobile: () => true }));
vi.mock('../../../lib/inventory/kardex', () => ({ getKardex: vi.fn(), buildKardexExportHref: vi.fn() }));
const mockedGetKardex = vi.mocked(getKardex);

const row = (overrides: { [K in keyof KardexRow]?: KardexRow[K] | undefined } = {}): KardexRow =>
  ({
  movementId: 'm1',
  occurredAt: '2026-10-01T15:00:00.000Z',
  movementType: 'RECEIPT',
  label: 'Ingreso de stock: Restock',
  entrada: 10,
  salida: 0,
  unitCost: 5,
  averageCostAfter: 5,
  stockAfter: 10,
  stockValueAfter: 50,
  ...overrides,
  }) as KardexRow;

const data = (rows: KardexRow[], withCost = true): KardexResponse => ({
  productVariantId: 'v1',
  locationId: 'l1',
  productId: 'p1',
  productName: 'Silla',
  sku: 'SIL-1',
  opening: withCost ? { stockUnits: 0, averageCost: 0, stockValue: 0 } : { stockUnits: 0 },
  rows,
  closing: { stockUnits: 0 },
  truncated: false,
  stockByLocation: [],
});

describe('Kardex on a phone', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders one card per movement instead of the table, with the same columns', () => {
    const { container } = render(
      <KardexTable data={data([row(), row({ movementId: 'm2', label: 'Venta', entrada: 0, salida: 3, stockAfter: 7, averageCostAfter: 5, stockValueAfter: 35 })])} />,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('Ingreso de stock: Restock')).toBeInTheDocument();
    expect(screen.getByText('Entrada +10')).toBeInTheDocument();
    expect(screen.getByText('Salida −3')).toBeInTheDocument();
    // Stock / Costo U / Costo K / V.Total of the first row
    expect(screen.getAllByText('Stock')).toHaveLength(2);
    expect(screen.getAllByText('Costo U')).toHaveLength(2);
    expect(screen.getByText('50.00')).toBeInTheDocument();
  });

  it('Costo U is shown only for an entrada (as on the web), and no cost tiles without pricing.cost.view', () => {
    const { rerender } = render(<KardexTable data={data([row({ movementId: 's', entrada: 0, salida: 2, unitCost: undefined })])} />);
    const costU = screen.getByText('Costo U').nextElementSibling!;
    expect(costU).toHaveTextContent('—');
    rerender(<KardexTable data={data([row({ unitCost: undefined, averageCostAfter: undefined, stockValueAfter: undefined })], false)} />);
    expect(screen.queryByText('Costo U')).not.toBeInTheDocument();
    expect(screen.queryByText('Costo K')).not.toBeInTheDocument();
    expect(screen.queryByText('V.Total')).not.toBeInTheDocument();
  });

  it('keeps the chronological sort toggle (same accessible name) and honours it', () => {
    const onToggle = vi.fn();
    const rows = [row({ movementId: 'a', label: 'Primero' }), row({ movementId: 'b', label: 'Segundo' })];
    const { rerender } = render(<KardexTable data={data(rows)} sortDescending={false} onToggleSort={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invertir orden cronológico' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    const order = () => screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(order()[0]).toContain('Primero');
    rerender(<KardexTable data={data(rows)} sortDescending onToggleSort={onToggle} />);
    expect(order()[0]).toContain('Segundo');
  });

  it('"Ver todos": each card names the product and the almacén, and tapping it jumps to that kardex', () => {
    const onRowClick = vi.fn();
    render(
      <KardexTable
        data={data([row()])}
        productoByMovementId={new Map([['m1', 'Silla de Comedor']])}
        almacenByMovementId={new Map([['m1', 'Matriz — General']])}
        onRowClick={onRowClick}
      />,
    );
    expect(screen.getByText('Silla de Comedor')).toBeInTheDocument();
    expect(screen.getByText('Matriz — General')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ingreso de stock/ }));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ movementId: 'm1' }));
  });

  it('shows the empty state and the truncated warning like the table', () => {
    const { rerender } = render(<KardexTable data={data([])} />);
    expect(screen.getByText('Sin movimientos en este rango')).toBeInTheDocument();
    rerender(<KardexTable data={{ ...data([row()]), truncated: true }} />);
    expect(screen.getByText(/Resultado truncado/)).toBeInTheDocument();
  });

  it('Stock por sucursal is a card per almacén with Físico and Disponible', () => {
    const { container } = render(
      <KardexStockByLocation rows={[{ locationId: 'l1', locationName: 'General', warehouseName: 'Matriz', stockPhysical: 12, stockAvailable: 9 }]} />,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('Matriz')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Físico').nextElementSibling).toHaveTextContent('12');
    expect(screen.getByText('Disponible').nextElementSibling).toHaveTextContent('9');
  });

  it('"Todos los almacenes": the totals stay, and the per-almacén breakdown opens as cards', async () => {
    mockedGetKardex.mockImplementation(async ({ locationId }) => ({
      ...data([]),
      locationId,
      closing: { stockUnits: locationId === 'l1' ? 4 : 6, averageCost: 10, stockValue: locationId === 'l1' ? 40 : 60 },
    }));
    render(
      <KardexAllLocations
        productVariantId="v1"
        locations={[
          { id: 'l1', name: 'General', warehouseName: 'Matriz' },
          { id: 'l2', name: 'Bodega', warehouseName: 'Norte' },
        ]}
      />,
    );
    const totals = await screen.findByTestId('all-locations-totals');
    expect(within(totals).getByText('10')).toBeInTheDocument(); // 4 + 6 units
    fireEvent.click(screen.getByRole('button', { name: /Existencias por sucursal y almacén \(2\)/ }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Bodega')).toBeInTheDocument());
    expect(screen.getByText('Norte')).toBeInTheDocument();
  });
});
