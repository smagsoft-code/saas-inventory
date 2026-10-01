import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { createPermissionChecker } from '../auth/permissions';
import type { PermissionCode } from '../auth/permission-codes';
import { getSalesSummary } from '../sales/reports';
import { getInventorySummary, getTransfersSummary } from '../inventory/reports';
import { listLocations } from '../inventory/locations';
import { loadHomeDashboard } from './dashboard';

vi.mock('../sales/reports', () => ({ getSalesSummary: vi.fn() }));
vi.mock('../inventory/reports', () => ({ getInventorySummary: vi.fn(), getTransfersSummary: vi.fn() }));
vi.mock('../inventory/locations', () => ({ listLocations: vi.fn() }));

const mSales = vi.mocked(getSalesSummary);
const mInventory = vi.mocked(getInventorySummary);
const mTransfers = vi.mocked(getTransfersSummary);
const mLocations = vi.mocked(listLocations);

const ALL_PERMS: PermissionCode[] = [
  'sales.orders.view',
  'inventory.view',
  'pricing.cost.view',
  'locations.view',
];

function tile(dashboard: Awaited<ReturnType<typeof loadHomeDashboard>>, key: string) {
  const t = dashboard.tiles.find((x) => x.key === key);
  if (!t) throw new Error(`no tile ${key}`);
  return t;
}

function salesSummary(overrides: Partial<Awaited<ReturnType<typeof getSalesSummary>>> = {}) {
  return {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-01T12:00:00.000Z',
    timezone: 'UTC',
    currency: 'USD',
    groupBy: 'day' as const,
    exceptional: 'all' as const,
    buckets: [],
    ...overrides,
  };
}

function inventorySummary(overrides: Partial<Awaited<ReturnType<typeof getInventorySummary>>> = {}) {
  return {
    generatedAt: '2026-09-01T12:00:00.000Z',
    groupBy: 'warehouse' as const,
    totals: { availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 0 },
    buckets: [],
    ...overrides,
  };
}

function transfersSummary(overrides: Partial<Awaited<ReturnType<typeof getTransfersSummary>>> = {}) {
  return {
    generatedAt: '2026-09-01T12:00:00.000Z',
    groupBy: 'destination' as const,
    totals: { inTransitQuantity: 0, openTransferCount: 0 },
    buckets: [],
    ...overrides,
  };
}

function locationsPage(data: { id: string; name: string }[]) {
  return {
    data: data.map((l) => ({ id: l.id, name: l.name, warehouseId: 'w1', code: l.id.toUpperCase(), isSellable: true, status: 'active', createdAt: 'x' })),
    meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mSales.mockResolvedValue(salesSummary() as never);
  mInventory.mockResolvedValue(inventorySummary() as never);
  mTransfers.mockResolvedValue(transfersSummary() as never);
  mLocations.mockResolvedValue(locationsPage([]) as never);
});

describe('loadHomeDashboard', () => {
  it('reads today\'s sales total from the day bucket', async () => {
    mSales.mockImplementation((q) =>
      Promise.resolve(
        (q.groupBy === 'day'
          ? salesSummary({ buckets: [{ key: '2026-09-01', orderCount: 3, subtotal: 100, discountTotal: 0, total: 480.5, avgTicket: 160.16 }] })
          : salesSummary()) as never,
      ),
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    const sales = tile(dash, 'sales-today');
    expect(sales.state).toBe('ready');
    expect(sales.value).toBe(480.5);
    expect(sales.currency).toBe('USD');
  });

  it('treats no bucket for today as a real zero, not an error', async () => {
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    const sales = tile(dash, 'sales-today');
    expect(sales.state).toBe('ready');
    expect(sales.value).toBe(0);
  });

  it('reads available quantity from inventory-summary totals', async () => {
    mInventory.mockResolvedValue(inventorySummary({ totals: { availableQuantity: 420, reservedQuantity: 10, outOfStockCount: 2 } }) as never);
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    expect(tile(dash, 'available-products').value).toBe(420);
  });

  it('exposes inventory value only when the caller holds pricing.cost.view', async () => {
    mInventory.mockResolvedValue(
      inventorySummary({ totals: { availableQuantity: 10, reservedQuantity: 0, outOfStockCount: 0, totalCostValue: 999.5, missingCostCount: 0 } }) as never,
    );
    const withCost = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    expect(tile(withCost, 'inventory-value').state).toBe('ready');
    expect(tile(withCost, 'inventory-value').value).toBe(999.5);

    const withoutCost = await loadHomeDashboard(
      createPermissionChecker(ALL_PERMS.filter((p) => p !== 'pricing.cost.view')),
      'UTC',
    );
    expect(tile(withoutCost, 'inventory-value').state).toBe('no-access');
  });

  it('notes how many variants have no cost loaded, without hiding the rest of the total', async () => {
    mInventory.mockResolvedValue(
      inventorySummary({ totals: { availableQuantity: 10, reservedQuantity: 0, outOfStockCount: 0, totalCostValue: 500, missingCostCount: 3 } }) as never,
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    expect(tile(dash, 'inventory-value').note).toMatch(/3/);
  });

  it('reads the open-transfer count from transfers-summary totals when no location filter is applied', async () => {
    mTransfers.mockResolvedValue(transfersSummary({ totals: { inTransitQuantity: 40, openTransferCount: 5 } }) as never);
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    const transfers = tile(dash, 'transfers-in-transit');
    expect(transfers.value).toBe(5);
    expect(transfers.note).toMatch(/40/);
  });

  it('narrows transfers-in-transit to one destination bucket when a location filter is applied', async () => {
    mLocations.mockResolvedValue(locationsPage([{ id: 'loc-1', name: 'Bodega Norte' }]) as never);
    mTransfers.mockResolvedValue(
      transfersSummary({
        totals: { inTransitQuantity: 40, openTransferCount: 5 },
        buckets: [
          { key: 'loc-1', destinationName: 'Bodega Norte', inTransitQuantity: 12, openTransferCount: 2 },
          { key: 'loc-2', destinationName: 'Bodega Sur', inTransitQuantity: 28, openTransferCount: 3 },
        ],
      }) as never,
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'loc-1');
    expect(tile(dash, 'transfers-in-transit').value).toBe(2);
  });

  it('reports a real zero for a location with nothing currently in transit toward it', async () => {
    mLocations.mockResolvedValue(locationsPage([{ id: 'loc-1', name: 'Bodega Norte' }]) as never);
    mTransfers.mockResolvedValue(
      transfersSummary({ totals: { inTransitQuantity: 40, openTransferCount: 5 }, buckets: [] }) as never,
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'loc-1');
    expect(tile(dash, 'transfers-in-transit').state).toBe('ready');
    expect(tile(dash, 'transfers-in-transit').value).toBe(0);
  });

  it('passes a valid locationId through to the sales and inventory report calls', async () => {
    mLocations.mockResolvedValue(locationsPage([{ id: 'loc-1', name: 'Bodega Norte' }]) as never);
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'loc-1');
    expect(mSales).toHaveBeenCalledWith(expect.objectContaining({ locationId: 'loc-1' }));
    expect(mInventory).toHaveBeenCalledWith(expect.objectContaining({ locationId: 'loc-1' }));
    expect(dash.selectedLocationId).toBe('loc-1');
  });

  it('ignores a locationId that matches no real location — never applies a bogus filter', async () => {
    mLocations.mockResolvedValue(locationsPage([{ id: 'loc-1', name: 'Bodega Norte' }]) as never);
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC', 'loc-does-not-exist');
    expect(mSales).not.toHaveBeenCalledWith(expect.objectContaining({ locationId: 'loc-does-not-exist' }));
    expect(dash.selectedLocationId).toBeUndefined();
  });

  it('degrades a single failing endpoint to "unavailable" without touching the others', async () => {
    mInventory.mockRejectedValue(new Error('boom'));
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    expect(tile(dash, 'available-products').state).toBe('unavailable');
    expect(tile(dash, 'available-products').value).toBe(0);
    expect(tile(dash, 'sales-today').state).toBe('ready');
  });

  it('maps a 403 on an endpoint to no-access (not an error)', async () => {
    mTransfers.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    expect(tile(dash, 'transfers-in-transit').state).toBe('no-access');
  });

  it('does not fire a request for a module the user lacks permission for', async () => {
    const dash = await loadHomeDashboard(createPermissionChecker(['inventory.view']), 'UTC');
    expect(mSales).not.toHaveBeenCalled();
    expect(tile(dash, 'sales-today').state).toBe('no-access');
    expect(dash.topProducts.state).toBe('no-access');
  });

  it('renders an inventory-value card without a currency suffix when sales (the only currency source) is unavailable', async () => {
    const dash = await loadHomeDashboard(createPermissionChecker(['inventory.view', 'pricing.cost.view']), 'UTC');
    expect(tile(dash, 'inventory-value').currency).toBeUndefined();
  });

  it('sorts the top-10 by quantity sold, not revenue, and caps at 10', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      key: `v${i}`,
      sku: `SKU-${i}`,
      productName: `Product ${i}`,
      orderCount: 1,
      quantity: i,
      discountTotal: 0,
      total: 1000 - i, // deliberately anti-correlated with quantity
    }));
    mSales.mockImplementation((q) =>
      Promise.resolve((q.groupBy === 'product' ? salesSummary({ buckets: many }) : salesSummary()) as never),
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    expect(dash.topProducts.items).toHaveLength(10);
    expect(dash.topProducts.items[0]).toMatchObject({ variantId: 'v14', quantity: 14 });
    expect(dash.topProducts.items.map((i) => i.quantity)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  });

  it('computes the day range from the given tenant timezone (F18-01, session.timezone)', async () => {
    await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'America/New_York', undefined, new Date('2026-06-15T02:00:00.000Z'));
    expect(mSales).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-06-14T04:00:00.000Z' }));
  });

  it('never sends a tenantId anywhere', async () => {
    await loadHomeDashboard(createPermissionChecker(ALL_PERMS), 'UTC');
    const allCalls = JSON.stringify([mSales.mock.calls, mInventory.mock.calls, mTransfers.mock.calls, mLocations.mock.calls]);
    expect(allCalls).not.toMatch(/tenant_?id/i);
  });

  it('hides the location filter options when the caller cannot list locations', async () => {
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS.filter((p) => p !== 'locations.view')), 'UTC');
    expect(dash.locationOptions).toEqual([]);
  });
});
