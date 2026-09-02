import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listTransfers, getTransfer } from './transfers';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

const emptyPage = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

describe('listTransfers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only page/pageSize by default — no tenantId', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listTransfers();
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/transfers', { query: { page: 1, pageSize: 20 } });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('passes only the real filters when set (single status)', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listTransfers({
      page: 2,
      pageSize: 50,
      status: 'dispatched',
      sourceLocationId: 'l1',
      destinationLocationId: 'l2',
    });
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/transfers', {
      query: { page: 2, pageSize: 50, status: 'dispatched', sourceLocationId: 'l1', destinationLocationId: 'l2' },
    });
  });
});

describe('getTransfer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads GET /inventory/transfers/:id', async () => {
    mocked.mockResolvedValueOnce({ id: 't1', items: [] });
    await getTransfer('t1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/inventory/transfers/t1');
  });
});
