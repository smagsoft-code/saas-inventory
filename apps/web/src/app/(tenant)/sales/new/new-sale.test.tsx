import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { NewSale } from './new-sale';
import type { LocationScope } from '../../../../lib/inventory/location-scope';
import type { Cart, Order } from '../../../../lib/types/sales';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const UNRESTRICTED: LocationScope = { unrestricted: true, locationIds: [] };

const WAREHOUSES_ONE = [{ id: 'wh-1', name: 'Sucursal Central' }];
const WAREHOUSES_TWO = [
  { id: 'wh-1', name: 'Sucursal Central' },
  { id: 'wh-2', name: 'Sucursal Norte' },
];
const LOCATIONS = [
  { id: 'loc-1', warehouseId: 'wh-1', name: 'Central' },
  { id: 'loc-2', warehouseId: 'wh-2', name: 'Norte' },
];

const CART: Cart = {
  id: 'cart-1',
  status: 'open',
  locationId: 'loc-1',
  customerId: 'cust-1',
  items: [
    {
      id: 'ci-1',
      productVariantId: 'var-1',
      productId: 'prod-1',
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

const ORDER: Order = {
  id: 'order-9',
  orderNumber: 'ORD-000009',
  status: 'pending',
  documentType: 'sales_note',
  locationId: 'loc-1',
  customer: { name: 'Acme' },
  items: [{ id: 'oi-1', productVariantId: 'var-1', sku: 'SKU-1', productName: 'Blender', quantity: 2, unitPrice: 10, maxPrice: 12, basePrice: 10, discountAmount: 4, isExceptionalDiscount: false, lineTotal: 20 }],
  payments: [],
  subtotal: 20,
  discountTotal: 4,
  taxTotal: 0,
  total: 20,
  currency: 'USD',
  createdAt: '',
  updatedAt: '',
};

function renderWithCart(cartOverrides: Partial<Cart> = {}) {
  render(
    <NewSale
      initialCart={{ ...CART, ...cartOverrides }}
      initialCustomer={{ id: 'cust-1', displayName: 'Acme' }}
      warehouses={WAREHOUSES_ONE}
      locations={LOCATIONS}
      scope={UNRESTRICTED}
      canViewProducts
      canSearchCustomers
      canManageCustomers
    />,
  );
}

/** Opens the cart modal and clicks "Crear pedido" — the default cart (1 line, customer already
 * set, subtotal 20) satisfies every client-side gate, so this is the shortest path to a checkout
 * attempt. */
function openModalAndCheckout(): void {
  fireEvent.click(screen.getByRole('button', { name: /^editar$/i }));
  fireEvent.click(screen.getByRole('button', { name: /crear pedido/i }));
}

describe('NewSale', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  describe('Paso A — Sucursal/Almacén (location-scope)', () => {
    it('auto-selects the single scoped warehouse/location and enables "Nueva venta"', () => {
      render(
        <NewSale
          initialCart={null}
          initialCustomer={null}
          warehouses={WAREHOUSES_ONE}
          locations={[LOCATIONS[0]!]}
          scope={UNRESTRICTED}
          canViewProducts
          canSearchCustomers
          canManageCustomers
        />,
      );
      expect(screen.getByLabelText(/sucursal/i)).toHaveValue('wh-1');
      expect(screen.getByLabelText(/almacén/i)).toHaveValue('loc-1');
      expect(screen.getByRole('button', { name: /nueva venta/i })).toBeEnabled();
    });

    it('leaves the picker open when several warehouses/locations are in scope', () => {
      render(
        <NewSale
          initialCart={null}
          initialCustomer={null}
          warehouses={WAREHOUSES_TWO}
          locations={LOCATIONS}
          scope={UNRESTRICTED}
          canViewProducts
          canSearchCustomers
          canManageCustomers
        />,
      );
      expect(screen.getByLabelText(/sucursal/i)).toHaveValue('');
      expect(screen.getByRole('button', { name: /nueva venta/i })).toBeDisabled();
    });

    it('only offers locations the caller is actually authorized for within a chosen warehouse', () => {
      const scope: LocationScope = { unrestricted: false, locationIds: ['loc-1'] };
      render(
        <NewSale
          initialCart={null}
          initialCustomer={null}
          warehouses={WAREHOUSES_ONE}
          locations={[...LOCATIONS, { id: 'loc-1b', warehouseId: 'wh-1', name: 'Central 2' }]}
          scope={scope}
          canViewProducts
          canSearchCustomers
          canManageCustomers
        />,
      );
      // Only one of the two wh-1 locations is in scope, so it still auto-selects.
      expect(screen.getByLabelText(/almacén/i)).toHaveValue('loc-1');
      expect(screen.queryByRole('option', { name: 'Central 2' })).not.toBeInTheDocument();
    });

    it('warns and disables the form when the caller has no scoped warehouse at all', () => {
      render(
        <NewSale
          initialCart={null}
          initialCustomer={null}
          warehouses={[]}
          locations={LOCATIONS}
          scope={{ unrestricted: false, locationIds: [] }}
          canViewProducts
          canSearchCustomers
          canManageCustomers
        />,
      );
      expect(screen.getByText(/no tienes ningún almacén asignado/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/sucursal/i)).toBeDisabled();
    });
  });

  describe('Paso B — "Nueva venta"', () => {
    it('POSTs /cart { locationId } — no tenantId — and opens the cart window', async () => {
      mockedFetch.mockResolvedValueOnce({ ...CART, items: [], customerId: undefined, subtotal: 0 });
      render(
        <NewSale
          initialCart={null}
          initialCustomer={null}
          warehouses={WAREHOUSES_ONE}
          locations={[LOCATIONS[0]!]}
          scope={UNRESTRICTED}
          canViewProducts
          canSearchCustomers
          canManageCustomers
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /nueva venta/i }));
      await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart', { method: 'POST', body: { locationId: 'loc-1' } }));
      expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
      expect(screen.getByRole('dialog', { name: /nueva venta/i })).toBeInTheDocument();
    });

    it('surfaces a 403 as a safe in-place message (unauthorized location)', async () => {
      mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
      render(
        <NewSale
          initialCart={null}
          initialCustomer={null}
          warehouses={WAREHOUSES_ONE}
          locations={[LOCATIONS[0]!]}
          scope={UNRESTRICTED}
          canViewProducts
          canSearchCustomers
          canManageCustomers
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /nueva venta/i }));
      expect(await screen.findByText(/no tienes autorización para operar en este almacén/i)).toBeInTheDocument();
    });
  });

  describe('once a cart exists', () => {
    it('shows a compact summary', () => {
      renderWithCart();
      expect(screen.getByText(/1 producto · subtotal 20\.00/i)).toBeInTheDocument();
    });

    it('"Editar" reopens the cart window with the current cart', () => {
      renderWithCart();
      fireEvent.click(screen.getByRole('button', { name: /^editar$/i }));
      expect(screen.getByRole('dialog', { name: /nueva venta/i })).toBeInTheDocument();
      expect(screen.getByText('Blender')).toBeInTheDocument();
    });

    it('"Eliminar" asks for confirmation, then DELETEs /cart and returns to the Sucursal/Almacén picker ("Nueva venta")', async () => {
      renderWithCart();
      fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));
      expect(screen.getByText(/se perderán todos los productos/i)).toBeInTheDocument();

      mockedFetch.mockResolvedValueOnce(undefined);
      fireEvent.click(screen.getByRole('button', { name: /sí, eliminar/i }));
      await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart', { method: 'DELETE' }));
      // Back to "no cart" — the Sucursal/Almacén picker, with its "Nueva venta" submit.
      expect(await screen.findByRole('button', { name: /nueva venta/i })).toBeInTheDocument();
    });

    it('"Eliminar" → "Cancelar" keeps the current cart untouched', () => {
      renderWithCart();
      fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));
      expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/cart', { method: 'DELETE' });
      expect(screen.getByRole('button', { name: /^editar$/i })).toBeInTheDocument();
    });
  });

  describe('checkout (from inside the cart window) — goes straight to the order detail page', () => {
    it('POSTs exactly CreateOrderDto (no payments) + a non-empty Idempotency-Key header — no tenantId, then redirects to /sales/:id', async () => {
      renderWithCart();
      mockedFetch.mockResolvedValueOnce(ORDER);
      openModalAndCheckout();
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sales/order-9'));

      const call = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/orders')!;
      const init = call[1] as { method: string; body: unknown; headers: Record<string, string> };
      expect(init.method).toBe('POST');
      expect(init.body).toEqual({ cartId: 'cart-1', documentType: 'sales_note' });
      expect(init.headers['Idempotency-Key']).toBeTruthy();
      expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
    });

    it('sends documentType: invoice after choosing Factura inside the window', async () => {
      renderWithCart();
      fireEvent.click(screen.getByRole('button', { name: /^editar$/i }));
      fireEvent.click(screen.getByLabelText('Factura'));
      mockedFetch.mockResolvedValueOnce(ORDER);
      fireEvent.click(screen.getByRole('button', { name: /crear pedido/i }));
      await waitFor(() =>
        expect(mockedFetch).toHaveBeenCalledWith('/api/v1/orders', expect.objectContaining({ body: { cartId: 'cart-1', documentType: 'invoice' } })),
      );
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sales/order-9'));
    });

    it('keeps the SAME Idempotency-Key when a failed checkout is retried', async () => {
      renderWithCart();
      fireEvent.click(screen.getByRole('button', { name: /^editar$/i }));
      mockedFetch.mockRejectedValueOnce(new ApiError(422, 'UNPROCESSABLE_ENTITY', 'Customer is missing data.', undefined));
      fireEvent.click(screen.getByRole('button', { name: /crear pedido/i }));
      await screen.findByText(/customer is missing data/i);

      mockedFetch.mockResolvedValueOnce(ORDER);
      fireEvent.click(screen.getByRole('button', { name: /crear pedido/i }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sales/order-9'));

      const orderCalls = mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/orders');
      expect(orderCalls).toHaveLength(2);
      const k1 = (orderCalls[0]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      const k2 = (orderCalls[1]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
      expect(k1).toBe(k2);
    });

    it('disables "Crear pedido" without a customer', () => {
      const { customerId, ...cartWithoutCustomer } = CART;
      void customerId;
      render(
        <NewSale
          initialCart={cartWithoutCustomer}
          initialCustomer={null}
          warehouses={WAREHOUSES_ONE}
          locations={LOCATIONS}
          scope={UNRESTRICTED}
          canViewProducts
          canSearchCustomers
          canManageCustomers
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^editar$/i }));
      expect(screen.getByRole('button', { name: /crear pedido/i })).toBeDisabled();
    });

    it('disables "Crear pedido" with an unsellable line', () => {
      renderWithCart({ items: [{ ...CART.items[0]!, sellable: false }] });
      fireEvent.click(screen.getByRole('button', { name: /^editar$/i }));
      expect(screen.getByRole('button', { name: /crear pedido/i })).toBeDisabled();
    });
  });

  it('never writes to browser storage', async () => {
    renderWithCart();
    mockedFetch.mockResolvedValueOnce(ORDER);
    openModalAndCheckout();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sales/order-9'));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
