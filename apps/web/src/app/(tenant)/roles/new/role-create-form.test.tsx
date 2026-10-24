import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import type { PermissionCatalogItem } from '../../../../lib/types/core';
import { RoleCreateForm } from './role-create-form';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

const CATALOG: PermissionCatalogItem[] = [
  { code: 'sales.orders.view', module: 'sales', description: 'Ver pedidos' },
  { code: 'sales.orders.create', module: 'sales', description: 'Crear pedidos' },
  { code: 'inventory.view', module: 'inventory', description: 'Ver inventario' },
];

describe('RoleCreateForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('POSTs the real DTO shape (name, description, selected permissionCodes) and navigates to the new role', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'new-role-id' });
    render(<RoleCreateForm catalog={CATALOG} />);

    fireEvent.change(screen.getByLabelText(/nombre del rol/i), { target: { value: 'Cajero' } });
    fireEvent.change(screen.getByLabelText(/descripción/i), { target: { value: 'Punto de venta' } });
    fireEvent.click(screen.getByLabelText('Ver el historial de ventas'));
    fireEvent.click(screen.getByLabelText('Crear y confirmar ventas'));

    fireEvent.click(screen.getByRole('button', { name: /crear rol/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/roles/new-role-id'));

    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/roles', {
      method: 'POST',
      body: { name: 'Cajero', description: 'Punto de venta', permissionCodes: ['sales.orders.view', 'sales.orders.create'] },
    });
  });

  it('groups the catalog by module, with a real permission checklist, not a flat list', () => {
    render(<RoleCreateForm catalog={CATALOG} />);
    expect(screen.getByText('Ventas')).toBeInTheDocument();
    expect(screen.getByText('Inventario')).toBeInTheDocument();
  });

  it('surfaces a 400 unknown-permission-code rejection safely, never a silent success', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'Unknown permission code(s): x.y.z', undefined));
    render(<RoleCreateForm catalog={CATALOG} />);
    fireEvent.change(screen.getByLabelText(/nombre del rol/i), { target: { value: 'Raro' } });
    fireEvent.click(screen.getByRole('button', { name: /crear rol/i }));
    expect(await screen.findByText(/unknown permission code/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
