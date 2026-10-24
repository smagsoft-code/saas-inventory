import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { createPermissionChecker } from '../auth/permissions';
import type { PermissionCode } from '../auth/permission-codes';
import { getSalesSummary } from '../sales/reports';
import { getInventorySummary } from '../inventory/reports';
import { listLocations } from '../inventory/locations';
import { listWarehouses } from '../inventory/warehouses';
import { getLocationScope } from '../inventory/location-scope';
import { listProductCatalog } from '../catalog/product-catalog';
import { loadHomeDashboard } from './dashboard';

vi.mock('../sales/reports', () => ({ getSalesSummary: vi.fn() }));
vi.mock('../inventory/reports', () => ({ getInventorySummary: vi.fn() }));
vi.mock('../inventory/locations', () => ({ listLocations: vi.fn() }));
vi.mock('../inventory/warehouses', () => ({ listWarehouses: vi.fn() }));
vi.mock('../inventory/location-scope', () => ({ getLocationScope: vi.fn() }));
vi.mock('../catalog/product-catalog', () => ({ listProductCatalog: vi.fn() }));

const mSales = vi.mocked(getSalesSummary);
const mInventory = vi.mocked(getInventorySummary);
const mLocations = vi.mocked(listLocations);
const mWarehouses = vi.mocked(listWarehouses);
const mScope = vi.mocked(getLocationScope);
const mProducts = vi.mocked(listProductCatalog);

const ALL_PERMS: PermissionCode[] = [
  'sales.orders.view',
  'inventory.view',
  'pricing.cost.view',
  'locations.view',
  'warehouses.view',
  'products.view',
];

// Fixed "now": 22 Oct 2026, 15:00 UTC. Tenant zone UTC, so month key = 2026-10-01.
const NOW = new Date('2026-10-22T15:00:00.000Z');

type Dash = Awaited<ReturnType<typeof loadHomeDashboard>>;
const tile = (d: Dash, key: string) => {
  const t = d.tiles.find((x) => x.key === key);
  if (!t) throw new Error(`no tile ${key}`);
  return t;
};
const highlight = (d: Dash, key: string) => {
  const h = d.highlights.find((x) => x.key === key);
  if (!h) throw new Error(`no highlight ${key}`);
  return h;
};

function bucket(key: string, total: number, extra: Record<string, number> = {}) {
  return { key, orderCount: 1, subtotal: total, discountTotal: 0, total, avgTicket: total, ...extra };
}

function salesSummary(buckets: unknown[] = [], groupBy: 'day' | 'month' | 'product' = 'day') {
  return { from: 'x', to: 'y', timezone: 'UTC', currency: 'USD', groupBy, exceptional: 'all' as const, buckets };
}

function inventorySummary(totals: Record<string, number> = {}) {
  return {
    generatedAt: 'x',
    groupBy: 'warehouse' as const,
    totals: { availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 0, ...totals },
    buckets: [],
  };
}

const location = (id: string, name: string, warehouseId = 'w1') => ({ id, name, warehouseId, code: id, isSellable: true, status: 'active', createdAt: 'x' });
const page = <T>(data: T[]) => ({ data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } });

beforeEach(() => {
  vi.clearAllMocks();
  mSales.mockImplementation((q) => Promise.resolve(salesSummary([], q.groupBy as 'day') as never));
  mInventory.mockResolvedValue(inventorySummary() as never);
  mLocations.mockResolvedValue(page([]) as never);
  mWarehouses.mockResolvedValue(page([]) as never);
  mScope.mockResolvedValue({ unrestricted: true, locationIds: [] });
  mProducts.mockResolvedValue(page([]) as never);
});

describe('loadHomeDashboard — KPI row', () => {
  it('Total productos = the active catalog rows the Productos screen lists (product-catalog total, status active)', async () => {
    mProducts.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 1, total: 55, totalPages: 55 } } as never);
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(tile(d, 'total-products').value).toBe(55);
    expect(mProducts).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('Total productos with no Almacén chosen is the whole catalog (no location or stock param sent)', async () => {
    await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(mProducts).toHaveBeenCalledWith({ status: 'active', pageSize: 1 });
    expect(tile(await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW), 'total-products').note).toBeUndefined();
  });

  it('has no stock-alerts card; Valor total de inventario = inventory cost value', async () => {
    mInventory.mockResolvedValue(inventorySummary({ outOfStockCount: 13, totalCostValue: 48668.5, missingCostCount: 2 }) as never);
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(d.tiles.map((t) => t.key)).not.toContain('stock-alerts');
    expect(tile(d, 'inventory-value').label).toBe('Valor total de inventario');
    expect(tile(d, 'inventory-value').value).toBe(48668.5);
    expect(tile(d, 'inventory-value').note).toMatch(/2/);
  });

  it('Valor total and Costo neto are hidden (no-access) without pricing.cost.view', async () => {
    mInventory.mockResolvedValue(inventorySummary({ totalCostValue: 100 }) as never);
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS.filter((p) => p !== 'pricing.cost.view')), 'UTC', undefined, NOW);
    expect(tile(d, 'inventory-value').state).toBe('no-access');
    expect(tile(d, 'net-cost-month').state).toBe('no-access');
    expect(highlight(d, 'sales-month').state).toBe('ready'); // sales themselves are not cost-gated
  });

  it('Ventas de <mes> (highlight) / Costo neto (KPI) of the month come from the current-month bucket, with the ganancia', async () => {
    mSales.mockImplementation((q) =>
      Promise.resolve(
        (q.groupBy === 'month'
          ? salesSummary(
              [bucket('2026-09-01', 500, { costTotal: 300, profit: 200 }), bucket('2026-10-01', 1000, { costTotal: 640.25, profit: 359.75, missingCostLines: 0 })],
              'month',
            )
          : salesSummary()) as never,
      ),
    );
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(highlight(d, 'sales-month').label).toBe('Ventas de octubre');
    expect(highlight(d, 'sales-month').value).toBe(1000);
    expect(d.tiles.map((t) => t.key)).not.toContain('sales-month'); // no small KPI duplicate
    expect(tile(d, 'net-cost-month').label).toBe('Costo neto (octubre)');
    expect(tile(d, 'net-cost-month').value).toBe(640.25);
    expect(tile(d, 'net-cost-month').sub).toMatch(/Ganancia/);
    expect(tile(d, 'net-cost-month').sub).toMatch(/359,75/);
  });

  it('notes sold lines that have no cost recorded', async () => {
    mSales.mockImplementation((q) =>
      Promise.resolve(
        (q.groupBy === 'month' ? salesSummary([bucket('2026-10-01', 100, { costTotal: 10, profit: 90, missingCostLines: 4 })], 'month') : salesSummary()) as never,
      ),
    );
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(tile(d, 'net-cost-month').note).toMatch(/4/);
  });
});

describe('loadHomeDashboard — highlight row', () => {
  it('Ventas de hoy / del mes / del año: day bucket, month bucket, sum of the year (in that order)', async () => {
    mSales.mockImplementation((q) => {
      if (q.groupBy === 'day') return Promise.resolve(salesSummary([bucket('2026-10-22', 120.5)]) as never);
      if (q.groupBy === 'month') return Promise.resolve(salesSummary([bucket('2026-01-01', 4000), bucket('2026-09-01', 5000), bucket('2026-10-01', 965.5)], 'month') as never);
      return Promise.resolve(salesSummary([], 'product') as never);
    });
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(highlight(d, 'sales-today').value).toBe(120.5);
    expect(d.highlights.map((h) => h.key)).toEqual(['sales-today', 'sales-month', 'sales-year']);
    expect(highlight(d, 'sales-month').value).toBe(965.5);
    expect(highlight(d, 'sales-year').value).toBe(9965.5);
    expect(highlight(d, 'sales-year').label).toBe('Ventas del 2026');
  });

  it('a month/day with no orders is a real zero, not an error', async () => {
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(highlight(d, 'sales-today')).toMatchObject({ state: 'ready', value: 0 });
    expect(highlight(d, 'sales-year')).toMatchObject({ state: 'ready', value: 0 });
  });

  it('reads the year from the tenant-local start of the year', async () => {
    await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(mSales).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'month', from: '2026-01-01T00:00:00.000Z' }));
  });

  it('degrades a failing sales read to unavailable (never 0) without breaking the rest', async () => {
    mSales.mockRejectedValue(new ApiError(500, 'X', 'boom', undefined));
    mInventory.mockResolvedValue(inventorySummary({ outOfStockCount: 3 }) as never);
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(highlight(d, 'sales-today').state).toBe('unavailable');
    expect(tile(d, 'inventory-value')).toMatchObject({ state: 'ready' });
  });

  it('hides sales cards entirely without sales.orders.view', async () => {
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS.filter((p) => p !== 'sales.orders.view')), 'UTC', undefined, NOW);
    expect(highlight(d, 'sales-today').state).toBe('no-access');
    expect(mSales).not.toHaveBeenCalled();
  });
});

describe('loadHomeDashboard — Almacén filter only offers what the user may use', () => {
  beforeEach(() => {
    mLocations.mockResolvedValue(page([location('l1', 'General', 'w1'), location('l2', 'Bodega', 'w2'), location('l3', 'Piso', 'w1')]) as never);
    mWarehouses.mockResolvedValue(page([{ id: 'w1', name: 'Matriz' }, { id: 'w2', name: 'Norte' }]) as never);
  });

  it('a restricted user sees only their assigned locations, labelled "Sucursal · Almacén"', async () => {
    mScope.mockResolvedValue({ unrestricted: false, locationIds: ['l2', 'l3'] });
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(d.locationOptions).toEqual([
      { id: 'l2', name: 'Norte · Bodega' },
      { id: 'l3', name: 'Matriz · Piso' },
    ]);
  });

  it('an unrestricted user (founding Administrador) sees every active location', async () => {
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(d.locationOptions.map((o) => o.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('ignores a requested location the user is not authorized for (never sent to a report)', async () => {
    mScope.mockResolvedValue({ unrestricted: false, locationIds: ['l2'] });
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'l1', NOW);
    expect(d.selectedLocationId).toBeUndefined();
    expect(mSales).toHaveBeenCalledWith(expect.not.objectContaining({ locationId: expect.anything() }));
  });

  it('applies an authorized location to sales and inventory reads', async () => {
    mScope.mockResolvedValue({ unrestricted: false, locationIds: ['l2'] });
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'l2', NOW);
    expect(d.selectedLocationId).toBe('l2');
    expect(mSales).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'month', locationId: 'l2' }));
    expect(mInventory).toHaveBeenCalledWith(expect.objectContaining({ locationId: 'l2' }));
  });

  it('Total productos follows the chosen Almacén: only products with stock available there, and says so', async () => {
    mProducts.mockImplementation((q) =>
      Promise.resolve({ data: [], meta: { page: 1, pageSize: 1, total: q?.locationId === 'l2' ? 7 : 55, totalPages: 1 } } as never),
    );
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'l2', NOW);
    expect(mProducts).toHaveBeenCalledWith({ status: 'active', pageSize: 1, locationId: 'l2', stock: 'available' });
    expect(tile(d, 'total-products').value).toBe(7);
    expect(tile(d, 'total-products').note).toBe('Con existencias en este almacén');
  });

  it('Total productos never sends a location the user is not authorized for', async () => {
    mScope.mockResolvedValue({ unrestricted: false, locationIds: ['l2'] });
    await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'l1', NOW);
    expect(mProducts).toHaveBeenCalledWith({ status: 'active', pageSize: 1 });
  });

  it('offers no locations when the scope cannot be determined (never "everything")', async () => {
    mScope.mockRejectedValue(new ApiError(500, 'X', 'boom', undefined));
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(d.locationOptions).toEqual([]);
  });

  it('falls back to the almacén name alone without warehouses.view', async () => {
    mScope.mockResolvedValue({ unrestricted: true, locationIds: [] });
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS.filter((p) => p !== 'warehouses.view')), 'UTC', undefined, NOW);
    expect(d.locationOptions[0]).toEqual({ id: 'l1', name: 'General' });
  });
});

describe('loadHomeDashboard — top products', () => {
  it('ranks today\'s products by quantity, top 10', async () => {
    mSales.mockImplementation((q) =>
      Promise.resolve(
        (q.groupBy === 'product'
          ? salesSummary(
              [
                { key: 'v1', sku: 'A', productName: 'Uno', orderCount: 1, quantity: 2, discountTotal: 0, total: 1 },
                { key: 'v2', sku: 'B', productName: 'Dos', orderCount: 1, quantity: 9, discountTotal: 0, total: 1 },
              ],
              'product',
            )
          : salesSummary()) as never,
      ),
    );
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(d.topProducts.items.map((i) => i.sku)).toEqual(['B', 'A']);
  });
});

describe('loadHomeDashboard — sales trend chart', () => {
  const monthSummary = (buckets: unknown[]) => salesSummary(buckets, 'month');

  it('defaults to the current year: 12 points, months not yet reached are null (never a fake zero), cost from costTotal', async () => {
    mSales.mockImplementation((q) =>
      Promise.resolve(
        (q.groupBy === 'month'
          ? monthSummary([bucket('2026-01-01', 500, { costTotal: 300, profit: 200 }), bucket('2026-10-01', 1000, { costTotal: 640.25, profit: 359.75 })])
          : salesSummary()) as never,
      ),
    );
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(d.trend.year).toBe(2026);
    expect(d.trend.hasCost).toBe(true);
    expect(d.trend.points).toHaveLength(12);
    expect(d.trend.points[0]).toEqual({ month: 1, sales: 500, cost: 300 });
    expect(d.trend.points[1]).toEqual({ month: 2, sales: 0, cost: 0 }); // a past month with no orders: real zero
    expect(d.trend.points[9]).toEqual({ month: 10, sales: 1000, cost: 640.25 });
    expect(d.trend.points[10]).toEqual({ month: 11, sales: null, cost: null }); // not reached yet (NOW = 22 Oct)
    expect(d.trend.points[11]).toEqual({ month: 12, sales: null, cost: null });
  });

  it('offers the current year and the four before it (newest first)', async () => {
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(d.trend.years).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it('another year is its own read over that calendar year; all 12 months are real (past) months', async () => {
    mSales.mockImplementation((q) =>
      Promise.resolve((q.groupBy === 'month' && q.from === '2025-01-01T00:00:00.000Z' ? monthSummary([bucket('2025-03-01', 800, { costTotal: 500, profit: 300 })]) : salesSummary()) as never),
    );
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW, 2025);
    expect(mSales).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'month', from: '2025-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' }));
    expect(d.trend.year).toBe(2025);
    expect(d.trend.points[2]).toEqual({ month: 3, sales: 800, cost: 500 });
    expect(d.trend.points[11]).toEqual({ month: 12, sales: 0, cost: 0 });
  });

  it('ignores a year outside the offered range (falls back to the current one)', async () => {
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW, 1999);
    expect(d.trend.year).toBe(2026);
    const future = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW, 2031);
    expect(future.trend.year).toBe(2026);
  });

  it('has no cost series without pricing.cost.view (cost is null on every point)', async () => {
    const d = await loadHomeDashboard(createPermissionChecker(ALL_PERMS.filter((p) => p !== 'pricing.cost.view')), 'UTC', undefined, NOW);
    expect(d.trend.hasCost).toBe(false);
    expect(d.trend.points.every((p) => p.cost === null)).toBe(true);
  });

  it('is no-access without sales.orders.view, and unavailable when the read fails', async () => {
    const hidden = await loadHomeDashboard(createPermissionChecker(ALL_PERMS.filter((p) => p !== 'sales.orders.view')), 'UTC', undefined, NOW);
    expect(hidden.trend.state).toBe('no-access');
    mSales.mockRejectedValue(new ApiError(500, 'X', 'boom', undefined));
    const failed = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', undefined, NOW);
    expect(failed.trend.state).toBe('unavailable');
  });

  it('follows the Almacén filter', async () => {
    mLocations.mockResolvedValue(page([location('l1', 'General')]) as never);
    await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'l1', NOW, 2025);
    expect(mSales).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'month', from: '2025-01-01T00:00:00.000Z', locationId: 'l1' }));
  });
});
