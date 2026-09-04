import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverApiFetch } from '../api/server';
import { getPlatformTenant, listPlatformTenants } from './tenants';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

const tenant = {
  id: '01a0-t1',
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('listPlatformTenants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads GET /platform/tenants with no query params (unpaginated) and no tenantId', async () => {
    mocked.mockResolvedValueOnce([tenant]);
    await expect(listPlatformTenants()).resolves.toEqual([tenant]);
    expect(mocked).toHaveBeenCalledWith('/api/v1/platform/tenants');
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenant_?id/i);
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/page|pageSize|status=/i);
  });
});

describe('getPlatformTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads GET /platform/tenants/:id — the id is the only path segment, never a body/query field', async () => {
    mocked.mockResolvedValueOnce(tenant);
    await expect(getPlatformTenant('01a0-t1')).resolves.toEqual(tenant);
    expect(mocked).toHaveBeenCalledWith('/api/v1/platform/tenants/01a0-t1');
    expect(mocked.mock.calls[0]).toHaveLength(1); // path only, no options object
  });
});
