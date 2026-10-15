import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { CategoryForm } from './category-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: pushMock }),
}));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const CATEGORY = {
  id: 'c1',
  name: 'Appliances',
  code: 'CAT-001',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
};
const PARENTS = [{ id: 'c0', name: 'Root' }];

describe('CategoryForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('create: pre-fills the proposed code and, if left untouched, sends NO code (the server assigns the next one)', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CATEGORY, id: 'new-id' });
    render(<CategoryForm mode="create" parentOptions={PARENTS} suggestedCode="CAT-004" />);
    expect(screen.getByLabelText(/^código/i)).toHaveValue('CAT-004');
    expect(screen.queryByLabelText(/^slug/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Power Tools' } });
    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/categories/new-id'));

    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories', { method: 'POST', body: { name: 'POWER TOOLS' } });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('create: a code the user typed is sent as is — capitals allowed', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CATEGORY, id: 'new-id' });
    render(<CategoryForm mode="create" parentOptions={PARENTS} suggestedCode="CAT-004" />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Muebles' } });
    fireEvent.change(screen.getByLabelText(/^código/i), { target: { value: 'Muebles-Sala' } });
    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories', {
      method: 'POST',
      body: { name: 'MUEBLES', code: 'Muebles-Sala' },
    });
  });

  it('create: blocks an invalid code (spaces, leading hyphen, too short) without calling the API', () => {
    render(<CategoryForm mode="create" parentOptions={PARENTS} suggestedCode="CAT-001" />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Xy' } });
    for (const bad of ['Not A Code', '-inicio', 'A']) {
      fireEvent.change(screen.getByLabelText(/^código/i), { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
      expect(screen.getByText(/letras, números y guiones \(sin espacios\)/i)).toBeInTheDocument();
    }
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('create: does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<CategoryForm mode="create" parentOptions={PARENTS} suggestedCode="CAT-001" />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Tools' } });
    const btn = screen.getByRole('button', { name: /crear categoría/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/categories')).toHaveLength(1);
    resolve({ ...CATEGORY, id: 'x' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });

  it('create: surfaces a 409 code conflict safely', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'A category with this code already exists.', undefined),
    );
    render(<CategoryForm mode="create" parentOptions={PARENTS} suggestedCode="CAT-001" />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Tools' } });
    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    expect(await screen.findByText(/code already exists/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('the category name is always typed in capitals', () => {
    render(<CategoryForm mode="create" parentOptions={PARENTS} suggestedCode="CAT-001" />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'ferretería ñandú' } });
    expect(screen.getByLabelText(/^nombre/i)).toHaveValue('FERRETERÍA ÑANDÚ');
  });

  it('edit: shows the stored code, is editable, and Save stays disabled until a field changes', async () => {
    mockedFetch.mockResolvedValueOnce(CATEGORY);
    render(<CategoryForm mode="edit" category={CATEGORY} parentOptions={PARENTS} />);
    const save = screen.getByRole('button', { name: /guardar cambios/i });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText(/^código/i)).toHaveValue('CAT-001');

    fireEvent.change(screen.getByLabelText(/^código/i), { target: { value: 'ELECTRO' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/categoría guardada/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories/c1', { method: 'PATCH', body: { code: 'ELECTRO' } });
  });

  it('edit: PATCHes only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(CATEGORY);
    render(<CategoryForm mode="edit" category={CATEGORY} parentOptions={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'inactive' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.getByText(/categoría guardada/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories/c1', { method: 'PATCH', body: { status: 'inactive' } });
  });

  it('never writes anything to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CATEGORY, id: 'x' });
    render(<CategoryForm mode="create" parentOptions={PARENTS} suggestedCode="CAT-001" />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Tools' } });
    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
