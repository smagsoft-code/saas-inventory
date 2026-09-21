import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import type { PermissionCatalogItem, Role } from '../../../../lib/types/core';
import { RolePermissionsEditor } from './role-permissions-editor';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

const CATALOG: PermissionCatalogItem[] = [
  { code: 'sales.orders.view', module: 'sales', description: 'Ver pedidos' },
  { code: 'sales.orders.create', module: 'sales', description: 'Crear pedidos' },
];

const ROLE: Role = {
  id: 'r1',
  name: 'Cajero',
  isSystemDefault: false,
  permissionCodes: ['sales.orders.view'],
  isAssignedToCaller: false,
};

describe('RolePermissionsEditor', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('ADR-0034: when isAssignedToCaller is true, shows an explanation instead of an editable picker — no PUT possible', () => {
    render(<RolePermissionsEditor role={{ ...ROLE, isAssignedToCaller: true }} catalog={CATALOG} />);
    expect(screen.getByText(/tu rol actual/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('PUTs the full replacement set and disables Save until something changes', async () => {
    mockedFetch.mockResolvedValueOnce({ ...ROLE, permissionCodes: ['sales.orders.view', 'sales.orders.create'] });
    render(<RolePermissionsEditor role={ROLE} catalog={CATALOG} />);

    const save = screen.getByRole('button', { name: /guardar permisos/i });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByText('Crear pedidos'));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/roles/r1/permissions', {
      method: 'PUT',
      body: { permissionCodes: ['sales.orders.view', 'sales.orders.create'] },
    });
  });

  it('shows the specific ADR-0034 explanation when the backend rejects with ROLE_SELF_PERMISSION_ESCALATION', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'ROLE_SELF_PERMISSION_ESCALATION', 'nope', undefined));
    render(<RolePermissionsEditor role={ROLE} catalog={CATALOG} />);

    fireEvent.click(screen.getByText('Crear pedidos'));
    fireEvent.click(screen.getByRole('button', { name: /guardar permisos/i }));

    expect(await screen.findByText(/no puedes modificar los permisos de un rol que tú mismo tienes asignado/i)).toBeInTheDocument();
  });
});
