import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { createPermissionChecker } from '../auth/permissions';
import type { PermissionCode } from '../auth/permission-codes';
import { listOrders } from '../sales/orders';
import { listPriceApprovals } from '../sales/price-approvals';
import { listReturns } from '../sales/returns';
import { listTransfers } from '../inventory/transfers';
import { listImportJobs } from '../imports/imports';
import { listProducts } from '../catalog/products';
import { getTenantSettings } from '../tenant/tenant-settings';
import { loadHomeDashboard } from './dashboard';

vi.mock('../sales/orders', () => ({ listOrders: vi.fn() }));
vi.mock('../sales/price-approvals', () => ({ listPriceApprovals: vi.fn() }));
vi.mock('../sales/returns', () => ({ listReturns: vi.fn() }));
vi.mock('../inventory/transfers', () => ({ listTransfers: vi.fn() }));
vi.mock('../imports/imports', () => ({ listImportJobs: vi.fn() }));
vi.mock('../catalog/products', () => ({ listProducts: vi.fn() }));
vi.mock('../tenant/tenant-settings', () => ({ getTenantSettings: vi.fn() }));

const mOrders = vi.mocked(listOrders);
const mApprovals = vi.mocked(listPriceApprovals);
const mReturns = vi.mocked(listReturns);
const mTransfers = vi.mocked(listTransfers);
const mImports = vi.mocked(listImportJobs);
const mProducts = vi.mocked(listProducts);
const mSettings = vi.mocked(getTenantSettings);

function page<T>(data: T[], total = data.length): { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } } {
  return { data, meta: { page: 1, pageSize: 20, total, totalPages: 1 } };
}

const ALL_PERMS: PermissionCode[] = [
  'sales.orders.view',
  'sales.returns.view',
  'inventory.view',
  'import.execute',
  'products.view',
  'pricing.discount.approve',
];

function tile(dashboard: Awaited<ReturnType<typeof loadHomeDashboard>>, key: string) {
  const t = dashboard.tiles.find((x) => x.key === key);
  if (!t) throw new Error(`no tile ${key}`);
  return t;
}

beforeEach(() => {
  vi.clearAllMocks();
  mOrders.mockResolvedValue(page([]) as never);
  mApprovals.mockResolvedValue(page([]) as never);
  mReturns.mockResolvedValue(page([]) as never);
  mTransfers.mockResolvedValue(page([]) as never);
  mImports.mockResolvedValue(page([]) as never);
  mProducts.mockResolvedValue(page([]) as never);
  mSettings.mockResolvedValue({ timezone: 'UTC', businessHours: [], updatedAt: null });
});

describe('loadHomeDashboard', () => {
  it('maps each meta.total to a ready tile and previews the rows', async () => {
    mOrders.mockImplementation((q) =>
      Promise.resolve(
        q?.status === 'pending'
          ? (page([{ id: 'o1', orderNumber: 'ORD-000001', customer: { name: 'Acme' } }], 3) as never)
          : (page([], 0) as never),
      ),
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    const pending = tile(dash, 'pending-orders');
    expect(pending.state).toBe('ready');
    expect(pending.count).toBe(3);
    expect(pending.items).toEqual([
      { id: 'o1', href: '/sales/o1', primary: 'ORD-000001', secondary: 'Acme' },
    ]);
  });

  it('treats total 0 as a real zero, not an error', async () => {
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    const pending = tile(dash, 'pending-orders');
    expect(pending.state).toBe('ready');
    expect(pending.count).toBe(0);
  });

  it('degrades a single failing endpoint to "unavailable" without touching the others', async () => {
    mApprovals.mockRejectedValue(new Error('boom'));
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    expect(tile(dash, 'pending-approvals').state).toBe('unavailable');
    expect(tile(dash, 'pending-approvals').count).toBe(0);
    expect(tile(dash, 'pending-orders').state).toBe('ready');
  });

  it('maps a 403 on an endpoint to no-access (not an error)', async () => {
    mReturns.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    expect(tile(dash, 'returns').state).toBe('no-access');
  });

  it('does not fire a request for a module the user lacks permission for', async () => {
    const dash = await loadHomeDashboard(createPermissionChecker(['sales.orders.view']));
    expect(mImports).not.toHaveBeenCalled();
    expect(mTransfers).not.toHaveBeenCalled();
    expect(mProducts).not.toHaveBeenCalled();
    expect(tile(dash, 'imports').state).toBe('no-access');
    expect(tile(dash, 'draft-products').state).toBe('no-access');
  });

  it('combines two statuses with two requests, never an invented status=a,b (GAP-MULTI-STATUS)', async () => {
    mReturns.mockImplementation((q) =>
      Promise.resolve(
        q?.status === 'requested'
          ? (page([{ id: 'r1', reason: 'damaged' }], 2) as never)
          : (page([], 3) as never),
      ),
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    expect(mReturns).toHaveBeenCalledWith(expect.objectContaining({ status: 'requested' }));
    expect(mReturns).toHaveBeenCalledWith(expect.objectContaining({ status: 'inspecting' }));
    for (const call of mReturns.mock.calls) {
      expect(String(call[0]?.status ?? '')).not.toContain(',');
    }
    expect(tile(dash, 'returns').count).toBe(5);
  });

  it('keeps the primary count when the secondary status request fails', async () => {
    mReturns.mockImplementation((q) =>
      q?.status === 'requested'
        ? Promise.resolve(page([{ id: 'r1', reason: 'x' }], 4) as never)
        : Promise.reject(new Error('boom')),
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    expect(tile(dash, 'returns').state).toBe('ready');
    expect(tile(dash, 'returns').count).toBe(4);
  });

  it('degrades orders-today to no-timezone when the tenant timezone is not readable', async () => {
    mSettings.mockResolvedValue(null);
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    const today = tile(dash, 'orders-today');
    expect(today.state).toBe('no-timezone');
    expect(today.note).toMatch(/GAP-TZ-VISIBILITY/);
    // no confirmed+createdFrom request was attempted
    expect(mOrders).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
  });

  it('computes orders-today from the tenant timezone when it is readable', async () => {
    mSettings.mockResolvedValue({ timezone: 'America/New_York', businessHours: [], updatedAt: null });
    mOrders.mockImplementation((q) =>
      Promise.resolve(q?.status === 'confirmed' ? (page([], 7) as never) : (page([], 0) as never)),
    );
    const dash = await loadHomeDashboard(
      createPermissionChecker(ALL_PERMS),
      new Date('2026-06-15T02:00:00.000Z'),
    );
    expect(mOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', createdFrom: '2026-06-14T04:00:00.000Z' }),
    );
    expect(tile(dash, 'orders-today').count).toBe(7);
  });

  it('never sends a tenantId anywhere', async () => {
    await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    const allCalls = JSON.stringify([
      mOrders.mock.calls,
      mApprovals.mock.calls,
      mReturns.mock.calls,
      mTransfers.mock.calls,
      mImports.mock.calls,
      mProducts.mock.calls,
    ]);
    expect(allCalls).not.toMatch(/tenant_?id/i);
  });

  it('marks the imports tile unavailable if either sub-status read fails', async () => {
    mImports.mockImplementation((q) =>
      q?.status === 'failed'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(page([], 1) as never),
    );
    const dash = await loadHomeDashboard(createPermissionChecker(ALL_PERMS));
    expect(tile(dash, 'imports').state).toBe('unavailable');
  });
});
