import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverApiFetch } from '../api/server';
import { getQrCode, listQrCodes } from './qr-codes';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);
const emptyPage = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

describe('listQrCodes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only page/pageSize by default — no tenantId, no invented params', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listQrCodes();
    expect(mocked).toHaveBeenCalledWith('/api/v1/qr-codes', { query: { page: 1, pageSize: 20 } });
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenant_?id/i);
  });

  it('adds targetType and targetId only when provided', async () => {
    mocked.mockResolvedValueOnce(emptyPage);
    await listQrCodes({ page: 2, targetType: 'location', targetId: 'l1' });
    expect(mocked).toHaveBeenCalledWith('/api/v1/qr-codes', {
      query: { page: 2, pageSize: 20, targetType: 'location', targetId: 'l1' },
    });
  });
});

describe('getQrCode', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads GET /qr-codes/:id', async () => {
    mocked.mockResolvedValueOnce({ id: 'q1' });
    await getQrCode('q1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/qr-codes/q1');
  });
});
