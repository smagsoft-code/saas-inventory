import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverApiFetch } from '../api/server';
import { getBalance, listBalances } from './balances';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

describe('listBalances', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only page/pageSize by default — no tenantId, no invented params', async () => {
    mocked.mockResolvedValueOnce({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
    await listBalances();
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/balances', { query: { page: 1, pageSize: 20 } });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('adds productVariantId and locationId only when provided', async () => {
    mocked.mockResolvedValueOnce({ data: [], meta: { page: 2, pageSize: 20, total: 0, totalPages: 1 } });
    await listBalances({ page: 2, productVariantId: 'v1', locationId: 'l1' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/balances', {
      query: { page: 2, pageSize: 20, productVariantId: 'v1', locationId: 'l1' },
    });
  });
});

describe('getBalance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the response through unchanged', async () => {
    const row = {
      id: 'b1',
      productVariantId: 'v1',
      locationId: 'l1',
      quantityPhysical: 10,
      quantityReserved: 2,
      quantityCommitted: 1,
      quantityAvailable: 7,
      version: 3,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    mocked.mockResolvedValueOnce(row);
    await expect(getBalance('b1')).resolves.toEqual(row);
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/balances/b1');
  });
});
