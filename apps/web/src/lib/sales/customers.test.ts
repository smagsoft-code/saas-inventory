import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listCustomers, getCustomer } from './customers';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);
const emptyPage = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

describe('listCustomers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only page/pageSize by default — no tenantId', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listCustomers();
    expect(mocked).toHaveBeenCalledWith('/api/v1/customers', { query: { page: 1, pageSize: 20 } });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('passes the real q / status / type filters', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listCustomers({ page: 3, pageSize: 50, q: 'acme', status: 'active', type: 'business' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/customers', {
      query: { page: 3, pageSize: 50, q: 'acme', status: 'active', type: 'business' },
    });
  });
});

describe('getCustomer', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads GET /customers/:id', async () => {
    mocked.mockResolvedValueOnce({ id: 'c1' });
    await getCustomer('c1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/customers/c1');
  });
});
