import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { ReturnForm } from './return-form';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const ORDERS = [{ id: 'o1', orderNumber: 'ORD-000001', customerName: 'Contoso' }];
const LOCATIONS = [{ id: 'loc-1', name: 'Main' }];
const ORDER_DETAIL = {
  id: 'o1',
  items: [
    { id: 'oi-1', sku: 'SKU-1', productName: 'Widget', quantity: 5, productVariantId: 'v1' },
    { id: 'oi-2', sku: 'SKU-2', productName: 'Gadget', quantity: 2, productVariantId: 'v2' },
  ],
};

function loadOrderResponses(existingReturns: unknown[] = []) {
  mockedFetch.mockResolvedValueOnce(ORDER_DETAIL); // GET /orders/o1
  mockedFetch.mockResolvedValueOnce({ data: existingReturns }); // GET /sales-returns?orderId=o1
}

describe('ReturnForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('loads the chosen order\'s lines and computes returnable = sold − already returned', async () => {
    loadOrderResponses([
      { status: 'resolved', items: [{ orderItemId: 'oi-1', quantityReturned: 2 }] },
      { status: 'cancelled', items: [{ orderItemId: 'oi-1', quantityReturned: 1 }] }, // ignored
    ]);
    render(<ReturnForm orders={ORDERS} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'o1' } });
    await waitFor(() => expect(screen.getByText('SKU-1')).toBeInTheDocument());
    // oi-1: 5 sold − 2 resolved = 3 returnable; oi-2: 2 − 0 = 2
    expect(screen.getByLabelText('Return quantity for SKU-1')).toHaveValue(3);
    expect(screen.getByLabelText('Return quantity for SKU-2')).toHaveValue(2);
  });

  it('POSTs exactly CreateReturnDto with an Idempotency-Key header and no tenantId', async () => {
    loadOrderResponses();
    mockedFetch.mockResolvedValueOnce({ id: 'r-new' }); // POST /sales-returns
    render(<ReturnForm orders={ORDERS} locations={LOCATIONS} preselectOrderId="o1" />);
    await waitFor(() => expect(screen.getByText('SKU-1')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'customer changed mind' } });
    fireEvent.click(screen.getByLabelText('Include SKU-1'));
    fireEvent.change(screen.getByLabelText('Return quantity for SKU-1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /file return/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/returns/r-new'));
    const [url, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(url).toBe('/api/v1/sales-returns');
    const options = opts as { method: string; body: Record<string, unknown>; headers: Record<string, string> };
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({
      orderId: 'o1',
      locationId: 'loc-1',
      reason: 'customer changed mind',
      items: [{ orderItemId: 'oi-1', quantity: 2 }],
    });
    expect(options.headers['Idempotency-Key']).toMatch(/.+/);
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('keeps File return disabled until an order, reason and at least one line are set', async () => {
    loadOrderResponses();
    render(<ReturnForm orders={ORDERS} locations={LOCATIONS} preselectOrderId="o1" />);
    await waitFor(() => expect(screen.getByText('SKU-1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /file return/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'damaged in transit' } });
    fireEvent.click(screen.getByLabelText('Include SKU-1'));
    expect(screen.getByRole('button', { name: /file return/i })).toBeEnabled();
  });

  it('surfaces a backend 409 (over-return) in place without navigating', async () => {
    loadOrderResponses();
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'only 1 remain returnable', undefined));
    render(<ReturnForm orders={ORDERS} locations={LOCATIONS} preselectOrderId="o1" />);
    await waitFor(() => expect(screen.getByText('SKU-1')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'return please' } });
    fireEvent.click(screen.getByLabelText('Include SKU-1'));
    fireEvent.click(screen.getByRole('button', { name: /file return/i }));
    expect(await screen.findByText(/remain returnable/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
