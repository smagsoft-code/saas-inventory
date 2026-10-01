import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../../lib/api/client';
import { AttributeOptionsEditor } from './attribute-options-editor';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const OPTIONS = [
  { id: 'o1', attributeDefinitionId: 'd1', code: 'black', label: 'Black', displayOrder: 0, status: 'active' },
  { id: 'o2', attributeDefinitionId: 'd1', code: 'white', label: 'White', displayOrder: 1, status: 'inactive' },
];

describe('AttributeOptionsEditor', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('read-only mode lists options without any controls', () => {
    render(<AttributeOptionsEditor definitionId="d1" options={OPTIONS} canManage={false} />);
    expect(screen.getByText('Black')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('adds an option via POST with the real DTO fields', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'o3', attributeDefinitionId: 'd1', code: 'red', label: 'Red', displayOrder: 2, status: 'active' });
    render(<AttributeOptionsEditor definitionId="d1" options={OPTIONS} canManage />);

    fireEvent.change(screen.getByLabelText(/código de la opción/i), { target: { value: 'red' } });
    fireEvent.change(screen.getByLabelText(/^etiqueta/i), { target: { value: 'Red' } });
    fireEvent.click(screen.getByRole('button', { name: /agregar opción/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/attribute-definitions/d1/options', {
      method: 'POST',
      body: { code: 'red', label: 'Red', displayOrder: 2 },
    });
  });

  it('deactivates / activates an option via PATCH status (no DELETE)', async () => {
    mockedFetch.mockResolvedValue({});
    render(<AttributeOptionsEditor definitionId="d1" options={OPTIONS} canManage />);

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/attribute-definitions/d1/options/o1', {
        method: 'PATCH',
        body: { status: 'inactive' },
      }),
    );

    mockedFetch.mockClear();
    mockedFetch.mockResolvedValue({});
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/attribute-definitions/d1/options/o2', {
        method: 'PATCH',
        body: { status: 'active' },
      }),
    );
  });
});
