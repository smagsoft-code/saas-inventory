import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { RoleDeleteButton } from './role-delete-button';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

describe('RoleDeleteButton', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('requires an explicit confirm step before calling DELETE', () => {
    render(<RoleDeleteButton roleId="r1" roleName="Cajero" />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/¿eliminar «cajero»\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/roles/r1', { method: 'DELETE' });
  });

  it('shows the backend 409 "role in use" message inline and lets the admin retry', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Cannot delete a role assigned to 2 user(s). Reassign them first.', undefined));
    render(<RoleDeleteButton roleId="r1" roleName="Cajero" />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText(/reassign them first/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('cancel returns to the plain Eliminar button without calling the API', () => {
    render(<RoleDeleteButton roleId="r1" roleName="Cajero" />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
