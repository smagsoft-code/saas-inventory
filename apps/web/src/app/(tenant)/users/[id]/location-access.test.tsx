import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { LocationAccess } from './location-access';
import type { UserLocationAssignment } from '../../../../lib/inventory/user-locations';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const locations = [
  { id: 'l1', name: 'Main floor', warehouseName: 'Central', status: 'active' },
  { id: 'l2', name: 'Back store', warehouseName: 'Central', status: 'active' },
];

function renderEditor(assignments: UserLocationAssignment[]) {
  return render(
    <LocationAccess userId="u1" userName="Ana" initialAssignments={assignments} locations={locations} />,
  );
}

describe('LocationAccess', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('starts "Unrestricted" when the user has no assignments (ADR-0024)', () => {
    renderEditor([]);
    expect(screen.getByLabelText(/unrestricted/i)).toBeChecked();
    expect(screen.getByRole('button', { name: /save location access/i })).toBeDisabled(); // not dirty
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); // location list hidden
  });

  it('starts "restricted" with the assigned locations checked', () => {
    renderEditor([{ locationId: 'l1', assignedAt: '2026-01-01T00:00:00Z' }]);
    expect(screen.getByLabelText(/restrict to selected/i)).toBeChecked();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked(); // l1
    expect(boxes[1]).not.toBeChecked(); // l2
  });

  it('PUTs an empty array when switched to Unrestricted', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    renderEditor([{ locationId: 'l1', assignedAt: '2026-01-01T00:00:00Z' }]);
    fireEvent.click(screen.getByLabelText(/unrestricted/i));
    fireEvent.click(screen.getByRole('button', { name: /save location access/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/users/u1/locations', {
        method: 'PUT',
        body: { locationIds: [] },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/every location/i);
  });

  it('PUTs the selected ids when restricting', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    renderEditor([]);
    fireEvent.click(screen.getByLabelText(/restrict to selected/i));
    fireEvent.click(screen.getByRole('checkbox', { name: /main floor/i }));
    fireEvent.click(screen.getByRole('button', { name: /save location access/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/users/u1/locations', {
        method: 'PUT',
        body: { locationIds: ['l1'] },
      }),
    );
  });

  it('never sends a tenantId or userId in the body', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    renderEditor([]);
    fireEvent.click(screen.getByLabelText(/restrict to selected/i));
    fireEvent.click(screen.getByRole('checkbox', { name: /main floor/i }));
    fireEvent.click(screen.getByRole('button', { name: /save location access/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    const [, options] = mockedFetch.mock.calls[0]!;
    expect(Object.keys((options as { body: object }).body)).toEqual(['locationIds']);
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenant_?id|userId/i);
  });

  it('refuses to save "restricted" with zero locations selected', () => {
    renderEditor([]);
    fireEvent.click(screen.getByLabelText(/restrict to selected/i));
    fireEvent.click(screen.getByRole('button', { name: /save location access/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/select at least one location/i);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows a safe message on 403 and does not confirm success', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'no', undefined));
    renderEditor([{ locationId: 'l1', assignedAt: 'x' }]);
    fireEvent.click(screen.getByLabelText(/unrestricted/i));
    fireEvent.click(screen.getByRole('button', { name: /save location access/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not authorized/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not touch browser storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderEditor([]);
    fireEvent.click(screen.getByLabelText(/restrict to selected/i));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
