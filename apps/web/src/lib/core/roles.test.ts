import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverApiFetch } from '../api/server';
import { getRole, listRoles } from './roles';

vi.mock('../api/server', () => ({ serverApiFetch: vi.fn() }));
const mocked = vi.mocked(serverApiFetch);

describe('listRoles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads GET /roles with no query/body — plain array, no tenantId', async () => {
    mocked.mockResolvedValueOnce([
      { id: 'r1', name: 'Administrador', isSystemDefault: true, permissionCodes: ['core.users.read'], isAssignedToCaller: true },
    ]);
    const roles = await listRoles();
    expect(roles).toHaveLength(1);
    expect(mocked).toHaveBeenCalledWith('/api/v1/roles');
    expect(mocked.mock.calls[0]).toHaveLength(1);
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenant_?id|page|status=/i);
  });
});

describe('getRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads GET /roles/:id', async () => {
    mocked.mockResolvedValueOnce({
      id: 'r1',
      name: 'Administrador',
      isSystemDefault: true,
      permissionCodes: [],
      isAssignedToCaller: false,
    });
    const role = await getRole('r1');
    expect(role.id).toBe('r1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/roles/r1');
  });
});
