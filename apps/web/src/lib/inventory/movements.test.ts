import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listMovements } from './movements';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

describe('listMovements', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only page/pageSize by default — no tenantId', async () => {
    mocked.mockResolvedValueOnce({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
    await listMovements();
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/movements', { query: { page: 1, pageSize: 20 } });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('passes only the real filters when set', async () => {
    mocked.mockResolvedValueOnce({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
    await listMovements({ locationId: 'l1', movementType: 'ADJUSTMENT_IN', productVariantId: 'v1' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/movements', {
      query: { page: 1, pageSize: 20, locationId: 'l1', movementType: 'ADJUSTMENT_IN', productVariantId: 'v1' },
    });
  });
});
