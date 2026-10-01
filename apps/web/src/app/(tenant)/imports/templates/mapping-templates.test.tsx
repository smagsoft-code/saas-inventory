import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import type { MappingTemplate } from '../../../../lib/types/imports';
import { MappingTemplates } from './mapping-templates';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const TEMPLATE: MappingTemplate = {
  id: 'tpl-1',
  name: 'Proveedor X',
  columnMapping: { CODIGO: 'sku', DESC: 'name' },
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('MappingTemplates', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('creates a template with the real DTO shape (name + columnMapping), no tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(<MappingTemplates initialTemplates={[]} categories={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva plantilla/i }));

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Proveedor Y' } });
    const headers = screen.getAllByLabelText('Encabezado de Excel');
    fireEvent.change(headers[0]!, { target: { value: 'CODIGO' } }); // maps to sku (default)

    fireEvent.click(screen.getByRole('button', { name: /crear plantilla/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    const [url, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(url).toBe('/api/v1/import-mapping-templates');
    const options = opts as { method: string; body: Record<string, unknown> };
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ name: 'Proveedor Y', columnMapping: { CODIGO: 'sku' } });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('blocks create until a column maps to sku', () => {
    render(<MappingTemplates initialTemplates={[]} categories={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva plantilla/i }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'X' } });

    const headers = screen.getAllByLabelText('Encabezado de Excel');
    fireEvent.change(headers[0]!, { target: { value: 'DESC' } });
    fireEvent.change(screen.getAllByLabelText('Se asigna a')[0]!, { target: { value: 'name' } });
    expect(screen.getByText(/una columna debe asignarse a "sku"/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /crear plantilla/i })).toBeDisabled();
  });

  it('edits an existing template via PATCH', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(<MappingTemplates initialTemplates={[TEMPLATE]} categories={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /editar/i }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Proveedor X (v2)' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar plantilla/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(url).toBe('/api/v1/import-mapping-templates/tpl-1');
    expect((opts as { method: string }).method).toBe('PATCH');
  });

  it('deletes a template through the real DELETE endpoint after a confirm step', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<MappingTemplates initialTemplates={[TEMPLATE]} categories={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar eliminación/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/import-mapping-templates/tpl-1', { method: 'DELETE' }),
    );
  });

  it('surfaces a 409 duplicate-name conflict in place', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'A mapping template with this name already exists.', undefined));
    render(<MappingTemplates initialTemplates={[]} categories={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva plantilla/i }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Dup' } });
    fireEvent.change(screen.getAllByLabelText('Encabezado de Excel')[0]!, { target: { value: 'CODIGO' } });
    fireEvent.click(screen.getByRole('button', { name: /crear plantilla/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
