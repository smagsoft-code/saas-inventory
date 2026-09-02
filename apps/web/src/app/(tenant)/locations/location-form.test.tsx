import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { LocationForm } from './location-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: pushMock }),
}));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const WAREHOUSES = [
  { id: 'w1', name: 'Central' },
  { id: 'w2', name: 'North' },
];
const PARENTS = [
  { id: 'l1', warehouseId: 'w1', name: 'Aisle A', code: 'A' },
  { id: 'l2', warehouseId: 'w2', name: 'Aisle N', code: 'N' },
];
const LOCATION = {
  id: 'loc1',
  warehouseId: 'w1',
  name: 'Bay 1',
  code: 'BAY-1',
  isSellable: true,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('LocationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('create: POSTs the real DTO fields, defaulting warehouse to the first option', async () => {
    mockedFetch.mockResolvedValueOnce({ ...LOCATION, id: 'new-id' });
    render(<LocationForm mode="create" warehouses={WAREHOUSES} parentCandidates={PARENTS} />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Bay 7' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'bay-7' } });
    fireEvent.click(screen.getByRole('button', { name: /create location/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/locations/new-id'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/locations', {
      method: 'POST',
      body: { warehouseId: 'w1', name: 'Bay 7', code: 'BAY-7' },
    });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('create: only lists parent candidates from the selected warehouse', () => {
    render(<LocationForm mode="create" warehouses={WAREHOUSES} parentCandidates={PARENTS} />);
    // default warehouse w1 → only "Aisle A"
    expect(screen.getByRole('option', { name: /aisle a/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /aisle n/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/warehouse/i), { target: { value: 'w2' } });
    expect(screen.getByRole('option', { name: /aisle n/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /aisle a/i })).not.toBeInTheDocument();
  });

  it('create: sends isSellable:false only when chosen', async () => {
    mockedFetch.mockResolvedValueOnce({ ...LOCATION, id: 'x' });
    render(<LocationForm mode="create" warehouses={WAREHOUSES} parentCandidates={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Quarantine' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'QTN' } });
    fireEvent.change(screen.getByLabelText(/sellable/i), { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('button', { name: /create location/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect((opts as { body: Record<string, unknown> }).body).toMatchObject({ isSellable: false });
  });

  it('create: surfaces a 409 code conflict safely', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'A location with this code already exists in this warehouse.', undefined),
    );
    render(<LocationForm mode="create" warehouses={WAREHOUSES} parentCandidates={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Bay' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'BAY' } });
    fireEvent.click(screen.getByRole('button', { name: /create location/i }));
    expect(await screen.findByText(/code already exists/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('edit: warehouse is read-only and PATCH sends only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(LOCATION);
    render(
      <LocationForm
        mode="edit"
        location={LOCATION}
        warehouses={[{ id: 'w1', name: 'Central' }]}
        parentCandidates={PARENTS}
      />,
    );
    expect(screen.getByLabelText(/warehouse/i)).toHaveAttribute('readonly');
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/sellable/i), { target: { value: 'no' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByText(/location saved/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/locations/loc1', {
      method: 'PATCH',
      body: { isSellable: false },
    });
  });

  it('never writes anything to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ ...LOCATION, id: 'x' });
    render(<LocationForm mode="create" warehouses={WAREHOUSES} parentCandidates={PARENTS} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Bay' } });
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'BAY' } });
    fireEvent.click(screen.getByRole('button', { name: /create location/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
