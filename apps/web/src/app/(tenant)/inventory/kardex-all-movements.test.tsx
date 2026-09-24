import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import * as kardexLib from '../../../lib/inventory/kardex';
import type { InventoryMovement } from '../../../lib/types/inventory';
import type { KardexResponse } from '../../../lib/types/kardex';
import { KardexAllMovements } from './kardex-all-movements';
import type { LocationOption } from './kardex-explorer';

vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/inventory/kardex', async () => {
  const actual = await vi.importActual<typeof kardexLib>('../../../lib/inventory/kardex');
  return { ...actual, getKardex: vi.fn() };
});

const mockedFetch = vi.mocked(apiFetch);
const mockedGetKardex = vi.mocked(kardexLib.getKardex);

const LOCATIONS: LocationOption[] = [
  { id: 'loc-1', name: 'Almacén Principal', warehouseId: 'w-1', warehouseName: 'Sucursal Centro' },
  { id: 'loc-2', name: 'Almacén Norte', warehouseId: 'w-2', warehouseName: 'Sucursal Norte' },
];

function movement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: 'm1',
    productVariantId: 'v1',
    locationId: 'loc-1',
    movementType: 'RECEIPT',
    quantity: 10,
    balanceAfter: 10,
    actorType: 'user',
    occurredAt: '2026-01-05T00:00:00Z',
    createdAt: '2026-01-05T00:00:00Z',
    ...overrides,
  };
}

function kardexFor(
  movementId: string,
  locationId: string,
  overrides: Partial<KardexResponse['rows'][number]> = {},
  product: { productVariantId?: string; productId?: string; productName?: string; sku?: string } = {},
): KardexResponse {
  return {
    productVariantId: product.productVariantId ?? 'v1',
    locationId,
    productId: product.productId ?? 'p1',
    productName: product.productName ?? 'Silla de Comedor',
    sku: product.sku ?? 'SILLA-1',
    opening: { stockUnits: 0, averageCost: 0, stockValue: 0, estimated: false },
    rows: [
      {
        movementId,
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
        ...overrides,
      },
    ],
    closing: { stockUnits: 10, averageCost: 5, stockValue: 50, estimated: false },
    truncated: false,
    stockByLocation: [],
  };
}

describe('KardexAllMovements', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('fetches the flat movement feed, then the per-pair Kardex for each distinct (variant, location) on the page, and renders the same columns plus Almacén', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [movement()], meta: { total: 1, totalPages: 1 } });
    mockedGetKardex.mockResolvedValueOnce(kardexFor('m1', 'loc-1'));

    render(<KardexAllMovements locations={LOCATIONS} />);

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/movements', { query: { page: 1, pageSize: 20 } }));
    await waitFor(() => expect(mockedGetKardex).toHaveBeenCalledWith({ productVariantId: 'v1', locationId: 'loc-1' }));

    expect(await screen.findByText('Ingreso de stock: Restock')).toBeInTheDocument();
    expect(screen.getByText('Almacén')).toBeInTheDocument();
    expect(screen.getByText('Sucursal Centro — Almacén Principal')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
  });

  it('calls getKardex once per distinct (variant, location) pair, not once per row', async () => {
    mockedFetch.mockResolvedValueOnce({
      data: [movement({ id: 'm1' }), movement({ id: 'm2', quantity: 5, balanceAfter: 15 })],
      meta: { total: 2, totalPages: 1 },
    });
    mockedGetKardex.mockResolvedValueOnce({
      ...kardexFor('m1', 'loc-1'),
      rows: [
        kardexFor('m1', 'loc-1').rows[0]!,
        { ...kardexFor('m2', 'loc-1').rows[0]!, movementId: 'm2', label: 'Ingreso de stock: Segundo', entrada: 5, stockAfter: 15 },
      ],
    });

    render(<KardexAllMovements locations={LOCATIONS} />);
    await screen.findByText('Ingreso de stock: Restock');
    expect(screen.getByText('Ingreso de stock: Segundo')).toBeInTheDocument();

    expect(mockedGetKardex).toHaveBeenCalledTimes(1);
  });

  it('passes occurredFrom/occurredTo through to both the flat fetch and each per-pair Kardex call', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [movement()], meta: { total: 1, totalPages: 1 } });
    mockedGetKardex.mockResolvedValueOnce(kardexFor('m1', 'loc-1'));

    render(<KardexAllMovements locations={LOCATIONS} occurredFrom="2026-01-01T00:00:00.000Z" occurredTo="2026-02-01T00:00:00.000Z" />);

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/movements', {
        query: { page: 1, pageSize: 20, occurredFrom: '2026-01-01T00:00:00.000Z', occurredTo: '2026-02-01T00:00:00.000Z' },
      }),
    );
    await waitFor(() =>
      expect(mockedGetKardex).toHaveBeenCalledWith({
        productVariantId: 'v1',
        locationId: 'loc-1',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      }),
    );
  });

  it('excludes RESERVATION/COMMITMENT rows — only physical movements reach the table, same as the per-variant Kardex', async () => {
    mockedFetch.mockResolvedValueOnce({
      data: [movement({ id: 'm1', movementType: 'RESERVATION' }), movement({ id: 'm2' })],
      meta: { total: 2, totalPages: 1 },
    });
    mockedGetKardex.mockResolvedValueOnce(kardexFor('m2', 'loc-1'));

    render(<KardexAllMovements locations={LOCATIONS} />);
    await screen.findByText('Ingreso de stock: Restock');

    // Only one pair fetched (from m2) — the RESERVATION row (m1) never triggers its own Kardex call.
    expect(mockedGetKardex).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when there are no movements in range', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [], meta: { total: 0, totalPages: 1 } });
    render(<KardexAllMovements locations={LOCATIONS} />);
    expect(await screen.findByText('Sin movimientos en este rango')).toBeInTheDocument();
  });

  it('paginates with Anterior/Siguiente, re-fetching both the flat page and its own pairs', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [movement({ id: 'm1' })], meta: { total: 40, totalPages: 2 } });
    mockedGetKardex.mockResolvedValueOnce(kardexFor('m1', 'loc-1'));
    render(<KardexAllMovements locations={LOCATIONS} />);
    await screen.findByText('Ingreso de stock: Restock');

    mockedFetch.mockResolvedValueOnce({ data: [movement({ id: 'm2', locationId: 'loc-2' })], meta: { total: 40, totalPages: 2 } });
    mockedGetKardex.mockResolvedValueOnce(kardexFor('m2', 'loc-2'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/inventory/movements', { query: { page: 2, pageSize: 20 } }));
    await waitFor(() => expect(mockedGetKardex).toHaveBeenLastCalledWith({ productVariantId: 'v1', locationId: 'loc-2' }));
    expect(screen.getByText('Sucursal Norte — Almacén Norte')).toBeInTheDocument();
  });

  it('adds a Producto column and calls onSelectRow with that exact row\'s product/variant/location when clicked', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [movement()], meta: { total: 1, totalPages: 1 } });
    mockedGetKardex.mockResolvedValueOnce(kardexFor('m1', 'loc-1', {}, { productVariantId: 'v1', productId: 'p1', productName: 'Silla de Comedor' }));
    const onSelectRow = vi.fn();

    render(<KardexAllMovements locations={LOCATIONS} onSelectRow={onSelectRow} />);
    await screen.findByText('Ingreso de stock: Restock');

    expect(screen.getByText('Producto')).toBeInTheDocument();
    expect(screen.getByText('Silla de Comedor')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ingreso de stock: Restock').closest('tr')!);

    expect(onSelectRow).toHaveBeenCalledWith({ productId: 'p1', productName: 'Silla de Comedor', productVariantId: 'v1', locationId: 'loc-1' });
  });
});
