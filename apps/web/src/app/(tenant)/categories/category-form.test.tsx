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
  slug: 'appliances',
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

  it('create: suggests a slug from the name, then POSTs only the real DTO fields', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CATEGORY, id: 'new-id' });
    render(<CategoryForm mode="create" parentOptions={PARENTS} />);

    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Power Tools' } });
    expect((screen.getByLabelText(/^slug/i) as HTMLInputElement).value).toBe('power-tools');

    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/categories/new-id'));

    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories', {
      method: 'POST',
      body: { name: 'Power Tools', slug: 'power-tools' },
    });
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(Object.keys((opts as { body: object }).body).sort()).toEqual(['name', 'slug']);
    // never a tenantId
    expect(JSON.stringify(opts)).not.toMatch(/tenantId/i);
  });

  it('create: blocks an invalid slug client-side without calling the API', () => {
    render(<CategoryForm mode="create" parentOptions={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^slug/i), { target: { value: 'Not A Slug' } });
    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    expect(screen.getByText(/minúsculas, números y guiones/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('create: does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<CategoryForm mode="create" parentOptions={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Tools' } });
    const btn = screen.getByRole('button', { name: /crear categoría/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/categories')).toHaveLength(1);
    resolve({ ...CATEGORY, id: 'x' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });

  it('create: surfaces a 409 slug conflict safely', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'A category with this slug already exists.', undefined),
    );
    render(<CategoryForm mode="create" parentOptions={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Tools' } });
    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    expect(await screen.findByText(/slug already exists/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('edit: Save stays disabled until a field changes, then PATCHes only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(CATEGORY);
    render(<CategoryForm mode="edit" category={CATEGORY} parentOptions={PARENTS} />);
    const save = screen.getByRole('button', { name: /guardar cambios/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'inactive' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/categoría guardada/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/categories/c1', {
      method: 'PATCH',
      body: { status: 'inactive' },
    });
  });

  it('never writes anything to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CATEGORY, id: 'x' });
    render(<CategoryForm mode="create" parentOptions={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Tools' } });
    fireEvent.click(screen.getByRole('button', { name: /crear categoría/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
