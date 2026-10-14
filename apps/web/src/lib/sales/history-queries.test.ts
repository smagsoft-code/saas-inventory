import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listReturns } from './returns';
import { listPriceApprovals } from './price-approvals';
import { getReturnsSummary } from './returns-reports';
import { getApprovalsSummary } from './approvals-reports';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);
const emptyPage = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

describe('history queries forward the shared filters as calendar days + Almacén', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listReturns: dateFrom/dateTo/locationId/status', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listReturns({ dateFrom: '2026-10-13', dateTo: '2026-10-15', locationId: 'l1', status: 'resolved' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/sales-returns', {
      query: { page: 1, pageSize: 20, status: 'resolved', locationId: 'l1', dateFrom: '2026-10-13', dateTo: '2026-10-15' },
    });
  });

  it('listPriceApprovals: dateFrom/dateTo/locationId/status', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listPriceApprovals({ dateFrom: '2026-10-13', locationId: 'l1', status: 'pending' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/price-approvals', {
      query: { page: 1, pageSize: 20, status: 'pending', locationId: 'l1', dateFrom: '2026-10-13' },
    });
  });

  it('summaries send dateFrom (no from/to) so the backend resolves the tenant-local day', async () => {
    mocked.mockResolvedValue({ buckets: [] });
    await getReturnsSummary({ dateFrom: '2026-10-13', groupBy: 'day', locationId: 'l1', status: 'resolved' });
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/reports/returns-summary', {
      query: { groupBy: 'day', dateFrom: '2026-10-13', locationId: 'l1', status: 'resolved' },
    });
    await getApprovalsSummary({ dateFrom: '2026-10-13', dateTo: '2026-10-14', groupBy: 'day' });
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/reports/approvals-summary', {
      query: { groupBy: 'day', dateFrom: '2026-10-13', dateTo: '2026-10-14' },
    });
  });
});
