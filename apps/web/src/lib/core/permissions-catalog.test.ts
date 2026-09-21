import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverApiFetch } from '../api/server';
import { listPermissionCatalog } from './permissions-catalog';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

describe('listPermissionCatalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads GET /permissions with no query/body — never tenant-scoped', async () => {
    mocked.mockResolvedValueOnce([{ code: 'core.roles.manage', module: 'core', description: 'Crear roles' }]);
    const catalog = await listPermissionCatalog();
    expect(catalog).toHaveLength(1);
    expect(mocked).toHaveBeenCalledWith('/api/v1/permissions');
    expect(mocked.mock.calls[0]).toHaveLength(1);
  });
});
