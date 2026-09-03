import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listReturns, getReturn } from './returns';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);
const emptyPage = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

describe('listReturns', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only page/pageSize by default — no tenantId', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listReturns();
    expect(mocked).toHaveBeenCalledWith('/api/v1/sales-returns', { query: { page: 1, pageSize: 20 } });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('passes status and orderId when set (the only supported filters)', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listReturns({ status: 'inspecting', orderId: 'o1' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/sales-returns', {
      query: { page: 1, pageSize: 20, status: 'inspecting', orderId: 'o1' },
    });
  });
});

describe('getReturn', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads GET /sales-returns/:id', async () => {
    mocked.mockResolvedValueOnce({ id: 'r1' });
    await getReturn('r1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/sales-returns/r1');
  });
});
