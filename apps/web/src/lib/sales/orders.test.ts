import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listOrders, getOrder, getOrderNotifications } from './orders';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);
const emptyPage = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

describe('listOrders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only page/pageSize by default — no tenantId', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listOrders();
    expect(mocked).toHaveBeenCalledWith('/api/v1/orders', { query: { page: 1, pageSize: 20 } });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('passes customerId when filtering a customer\'s orders', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listOrders({ customerId: 'c1', pageSize: 20 });
    expect(mocked).toHaveBeenCalledWith('/api/v1/orders', { query: { page: 1, pageSize: 20, customerId: 'c1' } });
  });
});

describe('listOrders business-day filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards dateFrom/dateTo as plain calendar days alongside the other filters', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listOrders({ dateFrom: '2026-10-13', dateTo: '2026-10-15', status: 'confirmed', documentType: 'invoice', customerId: 'c1' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/orders', {
      query: { page: 1, pageSize: 20, status: 'confirmed', documentType: 'invoice', customerId: 'c1', dateFrom: '2026-10-13', dateTo: '2026-10-15' },
    });
  });
});

describe('getOrder', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads GET /orders/:id', async () => {
    mocked.mockResolvedValueOnce({ id: 'o1' });
    await getOrder('o1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/orders/o1');
  });
});

describe('getOrderNotifications', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads GET /orders/:id/notifications — no tenantId', async () => {
    mocked.mockResolvedValueOnce({ orderId: 'o1', overallStatus: 'none', events: [] });
    await getOrderNotifications('o1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/orders/o1/notifications');
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenantId/i);
  });
});
