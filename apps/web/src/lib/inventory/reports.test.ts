import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverApiFetch } from '../api/server';
import { getInventorySummary } from './reports';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

describe('getInventorySummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends no query params by default — no tenantId, no invented from/to', async () => {
    mocked.mockResolvedValueOnce({
      generatedAt: '2026-09-01T00:00:00.000Z',
      groupBy: 'warehouse',
      totals: { availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 0 },
      buckets: [],
    });
    await getInventorySummary();
    expect(mocked).toHaveBeenCalledWith('/api/v1/reports/inventory-summary', { query: {} });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('adds warehouseId/categoryId/groupBy only when provided', async () => {
    mocked.mockResolvedValueOnce({
      generatedAt: '2026-09-01T00:00:00.000Z',
      groupBy: 'category',
      totals: { availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 0 },
      buckets: [],
    });
    await getInventorySummary({ warehouseId: 'w1', categoryId: 'c1', groupBy: 'category' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/reports/inventory-summary', {
      query: { warehouseId: 'w1', categoryId: 'c1', groupBy: 'category' },
    });
  });
});
