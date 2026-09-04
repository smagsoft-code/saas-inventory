import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RolesTable } from './roles-table';
import type { Role } from '../../../lib/types/core';

const roles: Role[] = [
  {
    id: 'r1',
    name: 'Administrador',
    description: 'Full access',
    isSystemDefault: true,
    permissionCodes: ['core.users.read', 'catalog.qr.manage'],
  },
  { id: 'r2', name: 'Bodega', isSystemDefault: true, permissionCodes: [] },
];

describe('RolesTable', () => {
  afterEach(() => cleanup());

  it('renders each role with its fields and permission codes', () => {
    render(<RolesTable roles={roles} />);
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.getByText('Full access')).toBeInTheDocument();
    const adminRow = screen.getByText('Administrador').closest('tr')!;
    expect(within(adminRow).getByText('catalog.qr.manage')).toBeInTheDocument();
    expect(within(adminRow).getByText('core.users.read')).toBeInTheDocument();
    expect(within(adminRow).getByText(/2 permission/i)).toBeInTheDocument();
  });

  it('shows "No permissions" for a role with an empty permission set (not an error)', () => {
    render(<RolesTable roles={roles} />);
    const bodegaRow = screen.getByText('Bodega').closest('tr')!;
    expect(within(bodegaRow).getByText(/no permissions/i)).toBeInTheDocument();
  });

  it('is read-only — no create / edit / delete controls', () => {
    render(<RolesTable roles={roles} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
