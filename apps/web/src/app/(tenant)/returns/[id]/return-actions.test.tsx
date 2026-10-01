import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { ReturnActions, type ActionLine } from './return-actions';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const R = 'return-1';
const LINES: ActionLine[] = [
  { returnItemId: 'ri-1', label: 'SKU-1 · Widget', quantityReturned: 2, inspected: false },
];
const SELLABLE = [{ id: 'loc-sell', name: 'Sellable' }];
const NON_SELLABLE = [{ id: 'loc-quar', name: 'Quarantine' }];

function renderActions(overrides: Partial<React.ComponentProps<typeof ReturnActions>> = {}) {
  return render(
    <ReturnActions
      returnId={R}
      status="requested"
      lines={LINES}
      allInspected={false}
      sellableLocations={SELLABLE}
      nonSellableLocations={NON_SELLABLE}
      canManage
      canCancel
      {...overrides}
    />,
  );
}

describe('ReturnActions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders nothing for a resolved return', () => {
    const { container } = renderActions({ status: 'resolved' });
    expect(container).toBeEmptyDOMElement();
  });

  it('only shows actions the status AND permission allow', () => {
    renderActions({ status: 'requested', canManage: false });
    expect(screen.queryByRole('button', { name: /inspeccionar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancelar devolución/i })).toBeInTheDocument();
  });

  it('cancel asks for confirmation then POSTs /cancel with no body and no tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({});
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: /cancelar devolución/i }));
    expect(mockedFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirmar cancelación/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/sales-returns/return-1/cancel', { method: 'POST' });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('inspect submits every line with disposition + location', async () => {
    mockedFetch.mockResolvedValueOnce({});
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: /^inspeccionar…$/i }));
    fireEvent.click(screen.getByRole('button', { name: /guardar inspección/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/sales-returns/return-1/inspect', {
      method: 'POST',
      body: { items: [{ returnItemId: 'ri-1', disposition: 'restock', dispositionLocationId: 'loc-sell' }] },
    });
  });

  it('switching a line to a non-restock disposition swaps to a non-sellable location', async () => {
    mockedFetch.mockResolvedValueOnce({});
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: /^inspeccionar…$/i }));
    fireEvent.change(screen.getByLabelText('Disposición'), { target: { value: 'damaged' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar inspección/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/sales-returns/return-1/inspect', {
      method: 'POST',
      body: { items: [{ returnItemId: 'ri-1', disposition: 'damaged', dispositionLocationId: 'loc-quar' }] },
    });
  });

  it('resolve confirms, then POSTs /resolve with an Idempotency-Key header (only when every line is inspected)', async () => {
    mockedFetch.mockResolvedValueOnce({});
    const inspected: ActionLine[] = [{ ...LINES[0]!, inspected: true, disposition: 'restock', dispositionLocationId: 'loc-sell' }];
    renderActions({ status: 'inspecting', lines: inspected, allInspected: true });
    fireEvent.click(screen.getByRole('button', { name: /resolver devolución/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar resolución/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, opts] = mockedFetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/sales-returns/return-1/resolve');
    expect((opts as { method: string }).method).toBe('POST');
    expect((opts as { headers: Record<string, string> }).headers['Idempotency-Key']).toMatch(/.+/);
  });

  it('resolve is disabled until every line is inspected', () => {
    renderActions({ status: 'inspecting', allInspected: false });
    expect(screen.getByRole('button', { name: /resolver devolución/i })).toBeDisabled();
  });

  it('does not double-submit cancel', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: /cancelar devolución/i }));
    const confirm = screen.getByRole('button', { name: /confirmar cancelación/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    resolve({});
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('surfaces a 403 as a location-authorization message and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    renderActions({ status: 'inspecting', allInspected: true });
    fireEvent.click(screen.getByRole('button', { name: /resolver devolución/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar resolución/i }));
    expect(await screen.findByText(/no tienes autorización para operar/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
