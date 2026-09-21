import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../../lib/api/client';
import type { Role } from '../../../../lib/types/core';
import { RoleEditForm } from './role-edit-form';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

const ROLE: Role = {
  id: 'r1',
  name: 'Cajero',
  description: 'Punto de venta',
  isSystemDefault: false,
  permissionCodes: ['sales.orders.view'],
  isAssignedToCaller: false,
};

describe('RoleEditForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('without core.roles.manage: shows a read-only message, no form', () => {
    render(<RoleEditForm role={ROLE} canManage={false} />);
    expect(screen.getByText(/necesitas el permiso/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('PATCHes only the changed field(s) — name/description, never permissionCodes', async () => {
    mockedFetch.mockResolvedValueOnce({ ...ROLE, description: 'Nueva descripción' });
    render(<RoleEditForm role={ROLE} canManage={true} />);

    fireEvent.change(screen.getByLabelText(/descripción/i), { target: { value: 'Nueva descripción' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText(/guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/roles/r1', { method: 'PATCH', body: { description: 'Nueva descripción' } });
  });

  it('deliberately allowed on the caller’s own currently-assigned role — ADR-0034 only blocks permission changes, never rename/describe', async () => {
    mockedFetch.mockResolvedValueOnce({ ...ROLE, isAssignedToCaller: true, name: 'Renombrado' });
    render(<RoleEditForm role={{ ...ROLE, isAssignedToCaller: true }} canManage={true} />);

    fireEvent.change(screen.getByLabelText(/nombre del rol/i), { target: { value: 'Renombrado' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/roles/r1', { method: 'PATCH', body: { name: 'Renombrado' } });
  });
});
