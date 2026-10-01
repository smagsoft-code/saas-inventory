import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { TransferWorkflowForm } from './transfer-workflow-form';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const PATH = '/api/v1/administration/tenant-settings';

function approvalCheckbox(): HTMLInputElement {
  return screen.getByText(/requiere aprobación/i).closest('label')!.querySelector('input')!;
}
function preparationCheckbox(): HTMLInputElement {
  return screen.getByText(/requiere preparación/i).closest('label')!.querySelector('input')!;
}

describe('TransferWorkflowForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('shows both gates checked by default and a hint when running on defaults', () => {
    render(<TransferWorkflowForm requireApproval requirePreparation usingDefaults canManage />);
    expect(approvalCheckbox().checked).toBe(true);
    expect(preparationCheckbox().checked).toBe(true);
  });

  it('keeps Save disabled until a checkbox changes, then PATCHes only the two flags', async () => {
    mockedFetch.mockResolvedValueOnce({
      timezone: 'UTC',
      businessHours: [],
      transfersRequireApproval: false,
      transfersRequirePreparation: true,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    render(<TransferWorkflowForm requireApproval requirePreparation usingDefaults={false} canManage />);

    const save = screen.getByRole('button', { name: /guardar flujo de transferencias/i });
    expect(save).toBeDisabled();

    fireEvent.click(approvalCheckbox());
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/flujo de transferencias guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith(PATH, {
      method: 'PATCH',
      body: { transfersRequireApproval: false, transfersRequirePreparation: true },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<TransferWorkflowForm requireApproval requirePreparation usingDefaults canManage />);
    fireEvent.click(preparationCheckbox());
    const save = screen.getByRole('button', { name: /guardar flujo de transferencias/i });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mockedFetch.mock.calls.filter(([p]) => p === PATH)).toHaveLength(1);
    resolve({ timezone: 'UTC', businessHours: [], transfersRequireApproval: true, transfersRequirePreparation: false, updatedAt: 'x' });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('shows a safe error message on API failure and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'stack trace here', undefined));
    render(<TransferWorkflowForm requireApproval requirePreparation usingDefaults canManage />);
    fireEvent.click(approvalCheckbox());
    fireEvent.click(screen.getByRole('button', { name: /guardar flujo de transferencias/i }));

    const alert = await screen.findByText(/algo salió mal/i);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText(/stack trace/i)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('surfaces a 403 as a permission message', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden', undefined));
    render(<TransferWorkflowForm requireApproval requirePreparation usingDefaults canManage />);
    fireEvent.click(approvalCheckbox());
    fireEvent.click(screen.getByRole('button', { name: /guardar flujo de transferencias/i }));
    expect(await screen.findByText(/permiso/i)).toBeInTheDocument();
  });

  it('renders read-only (no checkboxes, no button) when the caller cannot manage settings', () => {
    render(<TransferWorkflowForm requireApproval={false} requirePreparation usingDefaults={false} canManage={false} />);
    expect(screen.getByText(/automática/i)).toBeInTheDocument();
    expect(screen.getByText(/requerida/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText(/no tienes permiso/i)).toBeInTheDocument();
  });

  it('never writes settings to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({
      timezone: 'UTC',
      businessHours: [],
      transfersRequireApproval: false,
      transfersRequirePreparation: true,
      updatedAt: 'x',
    });
    render(<TransferWorkflowForm requireApproval requirePreparation usingDefaults canManage />);
    fireEvent.click(approvalCheckbox());
    fireEvent.click(screen.getByRole('button', { name: /guardar flujo de transferencias/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
