import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { KardexResponse } from '../../../lib/types/kardex';
import { KardexTable } from './kardex-table';

const BASE: KardexResponse = {
  productVariantId: 'v1',
  locationId: 'loc-1',
  productId: 'p1',
  productName: 'Silla de Comedor',
  sku: 'SILLA-1',
  opening: { stockUnits: 0, averageCost: 0, stockValue: 0, estimated: false },
  rows: [],
  closing: { stockUnits: 0, averageCost: 0, stockValue: 0, estimated: false },
  truncated: false,
  stockByLocation: [],
};

const RECEIPT_ROW: KardexResponse['rows'][number] = {
  movementId: 'm1',
  occurredAt: '2026-01-05T00:00:00Z',
  movementType: 'RECEIPT',
  label: 'Ingreso de stock: Restock',
  entrada: 10,
  salida: 0,
  unitCost: 5,
  unitCostEstimated: false,
  averageCostAfter: 5,
  stockAfter: 10,
  stockValueAfter: 50,
};

describe('KardexTable', () => {
  afterEach(() => cleanup());

  it('shows an empty state when there are no rows in range', () => {
    render(<KardexTable data={BASE} />);
    expect(screen.getByText('Sin movimientos en este rango')).toBeInTheDocument();
  });

  it('renders every column, renamed per owner feedback (Stock U → Stock, Stock S → V.Total), with a dark header and white text', () => {
    const data: KardexResponse = { ...BASE, rows: [RECEIPT_ROW], closing: { stockUnits: 10, averageCost: 5, stockValue: 50, estimated: false } };
    render(<KardexTable data={data} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Fecha del movimiento', 'Movimiento', 'Entrada', 'Costo U', 'Salida', 'Costo K', 'Stock', 'V.Total']);
    // The dark background is the shared `THead` default (`components/ui/table.tsx`) now, not a
    // per-page override — the system's actual predominant color is dark slate (Button's primary
    // variant), replicated to every table in the app, not just Kardex.
    expect(headers[0]?.closest('thead')?.className).toContain('bg-slate-900');
    for (const header of headers) {
      expect(header.className).toContain('text-white');
    }
    expect(screen.getByText('Ingreso de stock: Restock')).toBeInTheDocument();
    expect(screen.getAllByText('5.00').length).toBeGreaterThan(0); // Costo U y Costo K coinciden aquí
    expect(screen.getAllByText('50.00').length).toBeGreaterThan(0); // V.Total
  });

  it('never shows the word "estimado" nor "est.", even when a row is flagged estimated', () => {
    const data: KardexResponse = {
      ...BASE,
      rows: [{ ...RECEIPT_ROW, unitCostEstimated: true }],
      closing: { stockUnits: 10, averageCost: 5, stockValue: 50, estimated: true },
    };
    render(<KardexTable data={data} />);
    expect(screen.queryByText(/estimado/i)).not.toBeInTheDocument();
    expect(screen.queryByText('est.')).not.toBeInTheDocument();
  });

  it('never shows Saldo inicial nor Saldo final — both were removed from this table', () => {
    render(<KardexTable data={{ ...BASE, rows: [RECEIPT_ROW] }} />);
    expect(screen.queryByText(/saldo inicial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saldo final/i)).not.toBeInTheDocument();
  });

  it('colors Entrada green with a + sign, Salida red with a - sign, and Stock/V.Total pastel', () => {
    const outRow: KardexResponse['rows'][number] = {
      movementId: 'm2',
      occurredAt: '2026-01-06T00:00:00Z',
      movementType: 'SALE',
      label: 'Venta #ORD-1',
      entrada: 0,
      salida: 3,
      averageCostAfter: 5,
      stockAfter: 7,
      stockValueAfter: 35,
    };
    render(<KardexTable data={{ ...BASE, rows: [RECEIPT_ROW, outRow] }} />);
    const entradaCell = screen.getByText('+10');
    expect(entradaCell.className).toContain('bg-green-100');
    const salidaCell = screen.getByText('-3');
    expect(salidaCell.className).toContain('bg-red-100');
    const stockCell = screen.getByText('7');
    expect(stockCell.className).toContain('bg-blue-50');
  });

  it('omits every cost column when the caller lacks pricing.cost.view (inferred from the response shape)', () => {
    const data: KardexResponse = {
      productVariantId: 'v1',
      locationId: 'loc-1',
      productId: 'p1',
      productName: 'Silla de Comedor',
      sku: 'SILLA-1',
      opening: { stockUnits: 0 },
      rows: [
        {
          movementId: 'm1',
          occurredAt: '2026-01-05T00:00:00Z',
          movementType: 'SALE',
          label: 'Venta #ORD-000123',
          entrada: 0,
          salida: 3,
          stockAfter: 7,
        },
      ],
      closing: { stockUnits: 7 },
      truncated: false,
      stockByLocation: [],
    };
    render(<KardexTable data={data} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Fecha del movimiento', 'Movimiento', 'Entrada', 'Salida', 'Stock']);
    expect(screen.queryByText('Costo U')).not.toBeInTheDocument();
    expect(screen.queryByText('Costo K')).not.toBeInTheDocument();
    expect(screen.queryByText('V.Total')).not.toBeInTheDocument();
  });

  it('flags a truncated result', () => {
    const data: KardexResponse = { ...BASE, rows: [RECEIPT_ROW], truncated: true };
    render(<KardexTable data={data} />);
    expect(screen.getByText(/Resultado truncado/i)).toBeInTheDocument();
  });

  it('reverses the row order when sortDescending is true, without touching the totals', () => {
    const secondRow: KardexResponse['rows'][number] = { ...RECEIPT_ROW, movementId: 'm2', label: 'Ingreso de stock: Segundo', occurredAt: '2026-01-06T00:00:00Z' };
    const data: KardexResponse = { ...BASE, rows: [RECEIPT_ROW, secondRow] };
    render(<KardexTable data={data} sortDescending />);
    const labels = screen.getAllByText(/Ingreso de stock/).map((el) => el.textContent);
    expect(labels).toEqual(['Ingreso de stock: Segundo', 'Ingreso de stock: Restock']);
  });
});
