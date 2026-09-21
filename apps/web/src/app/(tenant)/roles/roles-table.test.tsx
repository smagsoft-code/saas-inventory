import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RolesTable } from './roles-table';
import type { Role } from '../../../lib/types/core';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const roles: Role[] = [
  {
    id: 'r1',
    name: 'Administrador',
    description: 'Full access',
    isSystemDefault: true,
    permissionCodes: ['core.users.read', 'catalog.qr.manage'],
    isAssignedToCaller: true,
  },
  { id: 'r2', name: 'Bodega', isSystemDefault: true, permissionCodes: [], isAssignedToCaller: false },
];

describe('RolesTable', () => {
  afterEach(() => cleanup());

  it('renders each role with its fields and permission codes', () => {
    render(<RolesTable roles={roles} canManage={false} />);
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.getByText('Full access')).toBeInTheDocument();
    const adminRow = screen.getByText('Administrador').closest('tr')!;
    expect(within(adminRow).getByText('catalog.qr.manage')).toBeInTheDocument();
    expect(within(adminRow).getByText('core.users.read')).toBeInTheDocument();
    expect(within(adminRow).getByText(/2 permiso/i)).toBeInTheDocument();
  });

  it('shows "No permissions" for a role with an empty permission set (not an error)', () => {
    render(<RolesTable roles={roles} canManage={false} />);
    const bodegaRow = screen.getByText('Bodega').closest('tr')!;
    expect(within(bodegaRow).getByText(/sin permisos/i)).toBeInTheDocument();
  });

  it('without core.roles.manage: no Editar/Eliminar controls, and role names are plain text', () => {
    render(<RolesTable roles={roles} canManage={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Editar')).not.toBeInTheDocument();
  });

  it('with core.roles.manage: shows Editar/Eliminar per row and marks the caller’s own role', () => {
    render(<RolesTable roles={roles} canManage={true} />);
    const adminRow = screen.getByText('Administrador').closest('tr')!;
    expect(within(adminRow).getByText('(tu rol)')).toBeInTheDocument();
    expect(within(adminRow).getAllByText('Editar').length).toBeGreaterThan(0);
    expect(within(adminRow).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();

    const bodegaRow = screen.getByText('Bodega').closest('tr')!;
    expect(within(bodegaRow).queryByText('(tu rol)')).not.toBeInTheDocument();
  });
});
