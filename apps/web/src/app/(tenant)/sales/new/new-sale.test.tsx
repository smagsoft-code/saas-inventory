import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { NewSale } from './new-sale';
import type { Cart } from '../../../../lib/types/sales';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const PRODUCTS = [{ id: 'prod-1', name: 'Blender' }];
const LOCATIONS = [{ id: 'loc-1', name: 'Central' }];

const CART: Cart = {
  id: 'cart-1',
  status: 'open',
  locationId: 'loc-1',
  customerId: 'cust-1',
  items: [
    {
      id: 'ci-1',
      productVariantId: 'var-1',
      sku: 'SKU-1',
      productName: 'Blender',
      quantity: 2,
      unitPrice: 10,
      lineSubtotal: 20,
      maxPrice: 12,
      basePrice: 10,
      sellable: true,
      availableAtLocation: 5,
    },
  ],
  subtotal: 20,
  createdAt: '',
  updatedAt: '',
};

const ORDER = {
  id: 'order-9',
  orderNumber: 'ORD-000009',
  status: 'pending',
  documentType: 'sales_note',
  locationId: 'loc-1',
  customer: { name: 'Acme' },
  items: [{ id: 'oi-1', productVariantId: 'var-1', sku: 'SKU-1', productName: 'Blender', quantity: 2, unitPrice: 10, maxPrice: 12, basePrice: 10, discountAmount: 4, isExceptionalDiscount: false, lineTotal: 20 }],
  subtotal: 20,
  discountTotal: 4,
  taxTotal: 0,
  total: 20,
  currency: 'USD',
  createdAt: '',
  updatedAt: '',
};

function readyCart({ noCustomer, ...overrides }: Partial<Cart> & { noCustomer?: boolean } = {}) {
  const cart: Cart = { ...CART, ...overrides };
  if (noCustomer) {
    delete cart.customerId;
  }
  return (
    <NewSale
      initialCart={cart}
      initialCustomer={{ id: 'cust-1', displayName: 'Acme' }}
      products={PRODUCTS}
      locations={LOCATIONS}
      canSearchCustomers
    />
  );
}

describe('NewSale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('starts a sale with POST /cart { locationId } — no tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CART, items: [], customerId: undefined, subtotal: 0 });
    render(
      <NewSale initialCart={null} initialCustomer={null} products={PRODUCTS} locations={LOCATIONS} canSearchCustomers />,
    );
    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: 'loc-1' } });
    fireEvent.click(screen.getByRole('button', { name: /start sale/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart', { method: 'POST', body: { locationId: 'loc-1' } }));
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('adds a line via GET /products/:id/variants then POST /cart/items (SKU shown, not a UUID)', async () => {
    render(readyCart());
    mockedFetch.mockResolvedValueOnce([
      { id: 'var-1', sku: 'SKU-1' },
      { id: 'var-2', sku: 'SKU-2' },
    ]);
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: 'prod-1' } });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/prod-1/variants');
    const opt = await screen.findByRole('option', { name: 'SKU-2' });
    expect(opt).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/variant/i), { target: { value: 'var-2' } });
    fireEvent.change(screen.getByLabelText(/^quantity$/i), { target: { value: '3' } });
    mockedFetch.mockResolvedValueOnce({ ...CART });
    fireEvent.click(screen.getByRole('button', { name: /add line/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items', {
        method: 'POST',
        body: { productVariantId: 'var-2', quantity: 3 },
      }),
    );
  });

  it('blocks adding a variant already on the cart (client mirror)', async () => {
    render(readyCart());
    mockedFetch.mockResolvedValueOnce([{ id: 'var-1', sku: 'SKU-1' }]);
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: 'prod-1' } });
    await screen.findByRole('option', { name: 'SKU-1' });
    fireEvent.change(screen.getByLabelText(/variant/i), { target: { value: 'var-1' } });
    fireEvent.change(screen.getByLabelText(/^quantity$/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /add line/i }));
    expect(screen.getByText(/already on the sale/i)).toBeInTheDocument();
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/cart/items')).toHaveLength(0);
  });

  it('updates a line quantity via PATCH /cart/items/:id and removes via DELETE', async () => {
    render(readyCart());
    mockedFetch.mockResolvedValueOnce({ ...CART });
    const qtyInput = screen.getByLabelText(/quantity for SKU-1/i);
    fireEvent.change(qtyInput, { target: { value: '4' } });
    fireEvent.blur(qtyInput);
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items/ci-1', { method: 'PATCH', body: { quantity: 4 } }),
    );

    mockedFetch.mockResolvedValueOnce({ ...CART, items: [], subtotal: 0 });
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items/ci-1', { method: 'DELETE' }),
    );
  });

  it('sets the customer via customer search + PATCH /cart { customerId }', async () => {
    render(readyCart({ noCustomer: true }));
    fireEvent.click(screen.getByRole('button', { name: /choose customer/i }));
    fireEvent.change(screen.getByPlaceholderText(/name, tax id/i), { target: { value: 'acme' } });
    mockedFetch.mockResolvedValueOnce({ data: [{ id: 'cust-7', displayName: 'Acme Corp', taxId: 'T7', email: 'x@y.com', phone: '5', address: { line1: 'a' }, status: 'active', type: 'business', createdAt: '', updatedAt: '' }] });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await screen.findByText('Acme Corp');
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/customers', { query: { q: 'acme', pageSize: 10 } });

    mockedFetch.mockResolvedValueOnce({ ...CART, customerId: 'cust-7' });
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart', { method: 'PATCH', body: { customerId: 'cust-7' } }),
    );
  });

  describe('checkout', () => {
    it('POSTs exactly CreateOrderDto + a non-empty Idempotency-Key header — no tenantId', async () => {
      mockedFetch.mockResolvedValueOnce(ORDER);
      render(readyCart());
      fireEvent.click(screen.getByRole('button', { name: /create order/i }));
      await screen.findByText("ORD-000009");

      const call = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/orders')!;
      const init = call[1] as { method: string; body: unknown; headers: Record<string, string> };
      expect(init.method).toBe('POST');
      expect(init.body).toEqual({ cartId: 'cart-1', documentType: 'sales_note' });
      expect(init.headers['Idempotency-Key']).toBeTruthy();
      expect(Object.keys(init.headers)).toEqual(['Idempotency-Key']);
      expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
    });

    it('shows the order result with a link to the order detail route', async () => {
      mockedFetch.mockResolvedValueOnce(ORDER);
      render(readyCart());
      fireEvent.click(screen.getByRole('button', { name: /create order/i }));
      const link = await screen.findByRole('link', { name: /view order/i });
      expect(link).toHaveAttribute('href', '/sales/order-9');
    });

    it('keeps the SAME Idempotency-Key when a failed checkout is retried', async () => {
      render(readyCart());
      mockedFetch.mockRejectedValueOnce(new ApiError(422, 'UNPROCESSABLE_ENTITY', 'Customer is missing data.', undefined));
      fireEvent.click(screen.getByRole('button', { name: /create order/i }));
      await screen.findByText(/customer is missing data/i);

      mockedFetch.mockResolvedValueOnce(ORDER);
      fireEvent.click(screen.getByRole('button', { name: /create order/i }));
      await screen.findByText(/ORD-000009/);

      const orderCalls = mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/orders');
      expect(orderCalls).toHaveLength(2);
      const k1 = (orderCalls[0]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      const k2 = (orderCalls[1]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      expect(k1).toBe(k2);
    });

    it('uses a different Idempotency-Key for a separate sale attempt', async () => {
      mockedFetch.mockResolvedValueOnce(ORDER);
      const { unmount } = render(readyCart());
      fireEvent.click(screen.getByRole('button', { name: /create order/i }));
      await screen.findByText(/ORD-000009/);
      const k1 = (mockedFetch.mock.calls.find(([p]) => p === '/api/v1/orders')![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      unmount();
      vi.clearAllMocks();

      mockedFetch.mockResolvedValueOnce({ ...ORDER, id: 'order-10' });
      render(readyCart());
      fireEvent.click(screen.getByRole('button', { name: /create order/i }));
      await screen.findByText(/ORD-000009/);
      const k2 = (mockedFetch.mock.calls.find(([p]) => p === '/api/v1/orders')![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      expect(k1).not.toBe(k2);
    });

    it('does not fire a second checkout on a double click', async () => {
      let resolve: (v: unknown) => void = () => {};
      mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      render(readyCart());
      const btn = screen.getByRole('button', { name: /create order/i });
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/orders')).toHaveLength(1);
      resolve(ORDER);
      await screen.findByText(/ORD-000009/);
    });

    it('surfaces a 403 as a safe in-place message', async () => {
      mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
      render(readyCart());
      fireEvent.click(screen.getByRole('button', { name: /create order/i }));
      expect(await screen.findByText(/not authorized to operate on this location/i)).toBeInTheDocument();
    });

    it('disables checkout without a customer, without lines, or with an unsellable line', () => {
      const { rerender } = render(readyCart({ noCustomer: true }));
      expect(screen.getByRole('button', { name: /create order/i })).toBeDisabled();
      rerender(readyCart({ items: [] }));
      expect(screen.getByRole('button', { name: /create order/i })).toBeDisabled();
      rerender(readyCart({ items: [{ ...CART.items[0]!, sellable: false }] }));
      expect(screen.getByRole('button', { name: /create order/i })).toBeDisabled();
    });
  });

  it('never writes to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce(ORDER);
    render(readyCart());
    fireEvent.click(screen.getByRole('button', { name: /create order/i }));
    await screen.findByText(/ORD-000009/);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
