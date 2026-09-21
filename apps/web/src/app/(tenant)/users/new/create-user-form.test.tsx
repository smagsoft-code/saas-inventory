import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import type { Role } from '../../../../lib/types/core';
import type { LocationScopeOption } from '../location-scope-picker';
import { CreateUserForm } from './create-user-form';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const ROLES: Role[] = [
  { id: 'r-admin', name: 'Administrador', isSystemDefault: true, permissionCodes: [], isAssignedToCaller: true },
  { id: 'r-bodega', name: 'Bodega', isSystemDefault: true, permissionCodes: [], isAssignedToCaller: false },
];

const LOCATIONS: LocationScopeOption[] = [
  { id: 'l1', name: 'Main floor', warehouseId: 'w1', warehouseName: 'Central', status: 'active' },
];

function fillBasics(): void {
  fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'Ana Lopez' } });
  fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: 'ana@example.com' } });
  fireEvent.change(screen.getByLabelText(/contraseña temporal/i), { target: { value: 'a-very-long-password' } });
}

describe('CreateUserForm — location assignment (single flow, reuses PUT /users/:id/locations)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('creates the user, then PUTs the selected location scope on the new id — one flow, two calls', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'new-user-id' }).mockResolvedValueOnce([]);
    render(<CreateUserForm roles={ROLES} locationOptions={LOCATIONS} />);

    fillBasics();
    fireEvent.change(screen.getByLabelText(/^rol$/i), { target: { value: 'r-bodega' } });
    fireEvent.click(screen.getByLabelText(/asignar almacenes\/ubicaciones/i));
    fireEvent.click(screen.getByRole('checkbox', { name: /main floor/i }));
    fireEvent.click(screen.getByRole('button', { name: /crear usuario/i }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedFetch).toHaveBeenNthCalledWith(1, '/api/v1/users', {
      method: 'POST',
      body: { email: 'ana@example.com', fullName: 'Ana Lopez', password: 'a-very-long-password', roleId: 'r-bodega' },
    });
    expect(mockedFetch).toHaveBeenNthCalledWith(2, '/api/v1/users/new-user-id/locations', {
      method: 'PUT',
      body: { locationIds: ['l1'] },
    });
    expect(pushMock).toHaveBeenCalledWith('/users/new-user-id');
  });

  it('does not call PUT when left on "Sin ubicación asignada" — nothing to assign yet', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'new-user-id' });
    render(<CreateUserForm roles={ROLES} locationOptions={LOCATIONS} />);

    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /crear usuario/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/users/new-user-id'));
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('ADR-0035: selecting the founding Administrador role hides the picker and skips the PUT entirely — assigning it would have no effect', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'admin-user-id' });
    render(<CreateUserForm roles={ROLES} locationOptions={LOCATIONS} />);

    fillBasics();
    fireEvent.change(screen.getByLabelText(/^rol$/i), { target: { value: 'r-admin' } });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText(/el rol administrador siempre puede operar en cualquier almacén/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /crear usuario/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/users/admin-user-id'));
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks submit client-side when "restricted" is chosen with zero locations selected', () => {
    render(<CreateUserForm roles={ROLES} locationOptions={LOCATIONS} />);
    fillBasics();
    fireEvent.click(screen.getByLabelText(/asignar almacenes\/ubicaciones/i));
    fireEvent.click(screen.getByRole('button', { name: /crear usuario/i }));
    expect(screen.getByText(/selecciona al menos una ubicación/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('when the user is created but the location PUT fails, still navigates to the new user (never loses the created user) and explains the failure', async () => {
    mockedFetch
      .mockResolvedValueOnce({ id: 'new-user-id' })
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    render(<CreateUserForm roles={ROLES} locationOptions={LOCATIONS} />);

    fillBasics();
    fireEvent.click(screen.getByLabelText(/asignar almacenes\/ubicaciones/i));
    fireEvent.click(screen.getByRole('checkbox', { name: /main floor/i }));
    fireEvent.click(screen.getByRole('button', { name: /crear usuario/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/users/new-user-id'));
    expect(screen.getByText(/el usuario se creó, pero no se pudo guardar su almacén asignado/i)).toBeInTheDocument();
  });

  it('renders no location section at all when the caller lacks core.users.locations.manage', () => {
    render(<CreateUserForm roles={ROLES} locationOptions={[]} />);
    expect(screen.queryByText(/almacén \/ alcance operativo/i)).not.toBeInTheDocument();
  });
});
