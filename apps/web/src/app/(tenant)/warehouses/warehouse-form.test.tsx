import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { WarehouseForm } from './warehouse-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: pushMock }),
}));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const WAREHOUSE = {
  id: 'w1',
  name: 'Central',
  code: 'CENTRAL',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('WarehouseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('create: POSTs only the real DTO fields and upper-cases the code', async () => {
    mockedFetch.mockResolvedValueOnce({ ...WAREHOUSE, id: 'new-id' });
    render(<WarehouseForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'North Depot' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'north-1' } });
    expect((screen.getByLabelText(/^code/i) as HTMLInputElement).value).toBe('NORTH-1');

    fireEvent.click(screen.getByRole('button', { name: /create warehouse/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/warehouses/new-id'));

    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/warehouses', {
      method: 'POST',
      body: { name: 'North Depot', code: 'NORTH-1' },
    });
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(Object.keys((opts as { body: object }).body).sort()).toEqual(['code', 'name']);
    expect(JSON.stringify(opts)).not.toMatch(/tenantId/i);
  });

  it('create: sends a non-empty address as an object', async () => {
    mockedFetch.mockResolvedValueOnce({ ...WAREHOUSE, id: 'x' });
    render(<WarehouseForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Depot' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'DEP' } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: 'Quito' } });
    fireEvent.click(screen.getByRole('button', { name: /create warehouse/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect((opts as { body: { address?: unknown } }).body.address).toEqual({ city: 'Quito' });
  });

  it('create: blocks an invalid code client-side without calling the API', () => {
    render(<WarehouseForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Depot' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'bad code!' } });
    fireEvent.click(screen.getByRole('button', { name: /create warehouse/i }));
    expect(screen.getByText(/uppercase letters and numbers/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('create: does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<WarehouseForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Depot' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'DEP' } });
    const btn = screen.getByRole('button', { name: /create warehouse/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/warehouses')).toHaveLength(1);
    resolve({ ...WAREHOUSE, id: 'x' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });

  it('create: surfaces a 409 code conflict safely', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'A warehouse with this code already exists.', undefined),
    );
    render(<WarehouseForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Depot' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'DEP' } });
    fireEvent.click(screen.getByRole('button', { name: /create warehouse/i }));
    expect(await screen.findByText(/code already exists/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('edit: Save stays disabled until a field changes, then PATCHes only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(WAREHOUSE);
    render(<WarehouseForm mode="edit" warehouse={WAREHOUSE} />);
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'inactive' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/warehouse saved/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/warehouses/w1', {
      method: 'PATCH',
      body: { status: 'inactive' },
    });
  });

  it('edit: a 403 is surfaced in place, never a redirect', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden', undefined));
    render(<WarehouseForm mode="edit" warehouse={WAREHOUSE} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Central 2' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/no longer have permission/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('never writes anything to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ ...WAREHOUSE, id: 'x' });
    render(<WarehouseForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Depot' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'DEP' } });
    fireEvent.click(screen.getByRole('button', { name: /create warehouse/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
