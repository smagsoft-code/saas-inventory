import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../lib/api/errors';
import { apiFetch } from '../../../../../lib/api/client';
import { TransferActions } from './transfer-actions';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('../../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const T = 'transfer-1';
const RECEIVABLE_ITEMS = [
  { id: 'ti-1', productVariantId: 'var-1', quantityRequested: 10, quantityDispatched: 10, quantityReceived: 0 },
];

describe('TransferActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders nothing for a terminal transfer', () => {
    const { container } = render(
      <TransferActions transferId={T} status="received" items={RECEIVABLE_ITEMS} canApprove canDispatch canReceive />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('explains why no action is available instead of rendering nothing, when a non-terminal status has no permitted action', () => {
    render(
      <TransferActions transferId={T} status="draft" items={[]} canApprove={false} canDispatch={false} canReceive={false} />,
    );
    expect(screen.getByText(/no tiene ese permiso/i)).toBeInTheDocument();
    expect(screen.getByText(/aprobarla/i)).toBeInTheDocument();
  });

  it('shows a blue success message after a successful transition', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(<TransferActions transferId={T} status="draft" items={[]} canApprove canDispatch canReceive />);
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }));
    expect(await screen.findByText(/transferencia aprobada correctamente/i)).toBeInTheDocument();
  });

  it('only shows actions the status AND permission allow', () => {
    render(
      <TransferActions
        transferId={T}
        status="draft"
        items={[]}
        canApprove
        canDispatch={false}
        canReceive={false}
      />,
    );
    expect(screen.getByRole('button', { name: /^aprobar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancelar transferencia/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /despachar/i })).not.toBeInTheDocument();
  });

  it('approve POSTs .../approve with no body and no tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(<TransferActions transferId={T} status="draft" items={[]} canApprove canDispatch canReceive />);
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/transfers/transfer-1/approve', { method: 'POST' });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('does not double-submit approve', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<TransferActions transferId={T} status="draft" items={[]} canApprove canDispatch canReceive />);
    const btn = screen.getByRole('button', { name: /^aprobar$/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    resolve({});
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('shows a location-authorization message on a 403 and does not redirect', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    render(<TransferActions transferId={T} status="approved" items={[]} canApprove canDispatch canReceive />);
    fireEvent.click(screen.getByRole('button', { name: /^preparar$/i }));
    expect(await screen.findByText(/no tienes autorización para operar/i)).toBeInTheDocument();
  });

  it('cancel is a two-step confirm', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(<TransferActions transferId={T} status="draft" items={[]} canApprove canDispatch canReceive />);
    fireEvent.click(screen.getByRole('button', { name: /cancelar transferencia/i }));
    expect(mockedFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirmar cancelación/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/transfers/transfer-1/cancel', { method: 'POST' });
  });

  describe('receive — idempotency', () => {
    function openAndSubmitReceive() {
      fireEvent.click(screen.getByRole('button', { name: /recibir…/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirmar recepción/i }));
    }

    it('sends a non-empty Idempotency-Key header with the receive body', async () => {
      mockedFetch.mockResolvedValueOnce({});
      render(<TransferActions transferId={T} status="dispatched" items={RECEIVABLE_ITEMS} canApprove canDispatch canReceive />);
      openAndSubmitReceive();
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());

      const call = mockedFetch.mock.calls.find(([p]) => String(p).endsWith('/receive'))!;
      const init = call[1] as { method: string; body: unknown; headers: Record<string, string> };
      expect(init.method).toBe('POST');
      expect(init.body).toEqual({ items: [{ transferItemId: 'ti-1', quantityReceived: 10 }] });
      expect(init.headers['Idempotency-Key']).toBeTruthy();
      expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
    });

    it('reuses the SAME key when a failed attempt is retried', async () => {
      render(<TransferActions transferId={T} status="dispatched" items={RECEIVABLE_ITEMS} canApprove canDispatch canReceive />);
      mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'temporary', undefined));
      openAndSubmitReceive();
      await screen.findByText(/temporary|conflict/i);

      mockedFetch.mockResolvedValueOnce({});
      fireEvent.click(screen.getByRole('button', { name: /confirmar recepción/i }));
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());

      const receiveCalls = mockedFetch.mock.calls.filter(([p]) => String(p).endsWith('/receive'));
      expect(receiveCalls).toHaveLength(2);
      const key1 = (receiveCalls[0]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      const key2 = (receiveCalls[1]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      expect(key1).toBe(key2);
    });

    it('uses a NEW key for a separate receiving attempt', async () => {
      mockedFetch.mockResolvedValue({});
      render(
        <TransferActions
          transferId={T}
          status="partially_received"
          items={[{ id: 'ti-1', productVariantId: 'var-1', quantityRequested: 10, quantityDispatched: 10, quantityReceived: 4 }]}
          canApprove
          canDispatch
          canReceive
        />,
      );
      openAndSubmitReceive();
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      openAndSubmitReceive();
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(2));

      const receiveCalls = mockedFetch.mock.calls.filter(([p]) => String(p).endsWith('/receive'));
      const key1 = (receiveCalls[0]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      const key2 = (receiveCalls[1]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      expect(key1).not.toBe(key2);
    });

    it('does not double-submit a receive', async () => {
      let resolve: (v: unknown) => void = () => {};
      mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      render(<TransferActions transferId={T} status="dispatched" items={RECEIVABLE_ITEMS} canApprove canDispatch canReceive />);
      fireEvent.click(screen.getByRole('button', { name: /recibir…/i }));
      const btn = screen.getByRole('button', { name: /confirmar recepción/i });
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(mockedFetch.mock.calls.filter(([p]) => String(p).endsWith('/receive'))).toHaveLength(1);
      resolve({});
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });
  });
});
