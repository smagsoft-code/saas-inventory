import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { OrderActions, type ExceptionalLine } from './order-actions';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const ORDER = 'order-1';
const EXC: ExceptionalLine[] = [{ orderItemId: 'oi-1', sku: 'SKU-1', productName: 'Widget', hasApproval: false }];

describe('OrderActions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders nothing for a confirmed order', () => {
    const { container } = render(
      <OrderActions
        orderId={ORDER}
        status="confirmed"
        canConfirm
        canCancel
        canRequestApproval
        exceptionalLines={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('only shows actions the status AND permission allow', () => {
    render(
      <OrderActions
        orderId={ORDER}
        status="pending"
        canConfirm
        canCancel={false}
        canRequestApproval={false}
        exceptionalLines={[]}
      />,
    );
    expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel order/i })).not.toBeInTheDocument();
  });

  it('confirm POSTs /confirm with no body and no tenantId, then refreshes', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <OrderActions orderId={ORDER} status="pending" canConfirm canCancel canRequestApproval exceptionalLines={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/orders/order-1/confirm', { method: 'POST' });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('does not double-submit confirm', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(
      <OrderActions orderId={ORDER} status="pending" canConfirm canCancel canRequestApproval exceptionalLines={[]} />,
    );
    const btn = screen.getByRole('button', { name: /confirm order/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    resolve({});
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('surfaces the backend 409 (approval still pending) in place', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'This order has an exceptional-discount request still awaiting approval', undefined),
    );
    render(
      <OrderActions orderId={ORDER} status="pending" canConfirm canCancel canRequestApproval exceptionalLines={EXC} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
    expect(await screen.findByText(/awaiting approval/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('cancel asks for confirmation before calling the endpoint', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <OrderActions orderId={ORDER} status="pending" canConfirm canCancel canRequestApproval exceptionalLines={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel order/i }));
    expect(mockedFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm cancel/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/orders/order-1/cancel', { method: 'POST' });
  });

  it('files a price-approval request with orderItemId + reason', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <OrderActions orderId={ORDER} status="pending" canConfirm canCancel canRequestApproval exceptionalLines={EXC} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /request approval/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'matched competitor quote' } });
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals', {
      method: 'POST',
      body: { orderItemId: 'oi-1', reason: 'matched competitor quote' },
    });
  });

  it('hides the request panel for lines that already have an approval', () => {
    render(
      <OrderActions
        orderId={ORDER}
        status="pending"
        canConfirm
        canCancel
        canRequestApproval
        exceptionalLines={[{ ...EXC[0]!, hasApproval: true }]}
      />,
    );
    expect(screen.queryByRole('button', { name: /request approval/i })).not.toBeInTheDocument();
  });
});
