import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listUserLocations } from './user-locations';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

describe('listUserLocations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads GET /users/:userId/locations — userId in the path only, never a body/query field', async () => {
    mocked.mockResolvedValueOnce([{ locationId: 'l1', assignedAt: '2026-01-01T00:00:00Z' }]);
    const rows = await listUserLocations('u1');
    expect(rows).toEqual([{ locationId: 'l1', assignedAt: '2026-01-01T00:00:00Z' }]);
    expect(mocked).toHaveBeenCalledWith('/api/v1/users/u1/locations');
    expect(mocked.mock.calls[0]).toHaveLength(1);
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenant_?id/i);
  });

  it('passes an empty array straight through (ADR-0024: empty = unrestricted, not an error)', async () => {
    mocked.mockResolvedValueOnce([]);
    await expect(listUserLocations('u1')).resolves.toEqual([]);
  });
});
