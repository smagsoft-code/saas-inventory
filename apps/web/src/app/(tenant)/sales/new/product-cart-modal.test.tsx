import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { ProductCartModal } from './product-cart-modal';
import type { Cart } from '../../../../lib/types/sales';

vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
// `CreateCustomerModal` -> `CustomerForm` calls `useRouter()` even though this suite never
// triggers a real navigation (the "+"/Enter-to-create path only renders the form, never submits
// it) — same mock `create-customer-modal.test.tsx` uses.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const mockedFetch = vi.mocked(apiFetch);

const EMPTY_CART: Cart = {
  id: 'cart-1',
  status: 'open',
  locationId: 'loc-1',
  items: [],
  subtotal: 0,
  createdAt: '',
  updatedAt: '',
};

const CART_WITH_LINE: Cart = {
  ...EMPTY_CART,
  customerId: 'cust-1',
  items: [
    {
      id: 'ci-1',
      productVariantId: 'var-1',
      productId: 'prod-1',
      sku: 'SKU-1',
      productName: 'Blender',
      quantity: 2,
      unitPrice: 15,
      lineSubtotal: 30,
      maxPrice: 15,
      basePrice: 10,
      minPrice: 8,
      sellable: true,
      availableAtLocation: 5,
    },
  ],
  subtotal: 30,
};

function renderModal(cart: Cart = EMPTY_CART, overrides: Partial<Parameters<typeof ProductCartModal>[0]> = {}) {
  const onCartUpdated = vi.fn();
  const onClose = vi.fn();
  const onSelectCustomer = vi.fn().mockResolvedValue(undefined);
  const onDocumentTypeChange = vi.fn();
  const onCheckout = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <ProductCartModal
      open
      onClose={onClose}
      cart={cart}
      canViewProducts
      onCartUpdated={onCartUpdated}
      customerLabel={null}
      selectedCustomer={null}
      canSearchCustomers
      canManageCustomers
      onSelectCustomer={onSelectCustomer}
      documentType="sales_note"
      onDocumentTypeChange={onDocumentTypeChange}
      onCheckout={onCheckout}
      {...overrides}
    />,
  );
  return { ...result, onCartUpdated, onClose, onSelectCustomer, onDocumentTypeChange, onCheckout };
}

describe('ProductCartModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('cliente', () => {
    it('shows the customer search bar at the top of the window, with a "+" to create one', () => {
      renderModal(EMPTY_CART);
      expect(screen.getByLabelText(/buscar cliente/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /crear cliente nuevo/i })).toBeInTheDocument();
    });

    it('selects a customer by clicking anywhere on its result row', async () => {
      const { onSelectCustomer } = renderModal(EMPTY_CART);
      vi.useFakeTimers();
      mockedFetch.mockResolvedValueOnce({ data: [{ id: 'cust-1', displayName: 'Acme SA', taxId: '0999999999' }] });
      fireEvent.change(screen.getByLabelText(/buscar cliente/i), { target: { value: 'acme' } });
      await vi.advanceTimersByTimeAsync(350);
      vi.useRealTimers();
      const row = await screen.findByRole('button', { name: /acme sa/i });
      fireEvent.click(row);
      await waitFor(() => expect(onSelectCustomer).toHaveBeenCalledWith({ id: 'cust-1', displayName: 'Acme SA', taxId: '0999999999' }));
    });

    it('pressing Enter with no search results opens "Crear nuevo cliente" with the typed text prefilled', async () => {
      renderModal(EMPTY_CART);
      vi.useFakeTimers();
      mockedFetch.mockResolvedValueOnce({ data: [] });
      const input = screen.getByLabelText(/buscar cliente/i);
      fireEvent.change(input, { target: { value: '1234567890' } });
      await vi.advanceTimersByTimeAsync(350);
      vi.useRealTimers();
      await screen.findByText(/ningún cliente coincide/i);
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(await screen.findByRole('dialog', { name: /crear nuevo cliente/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Cédula')).toHaveValue('1234567890');
    });

    it('the "+" button also opens "Crear nuevo cliente", prefilled with whatever is already typed', () => {
      renderModal(EMPTY_CART);
      fireEvent.change(screen.getByLabelText(/buscar cliente/i), { target: { value: '0999999999' } });
      fireEvent.click(screen.getByRole('button', { name: /crear cliente nuevo/i }));
      expect(screen.getByRole('dialog', { name: /crear nuevo cliente/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Cédula')).toHaveValue('0999999999');
    });

    it('once a customer is selected, shows its name and a "Cambiar" affordance instead of the search bar', () => {
      renderModal(CART_WITH_LINE, { customerLabel: 'Acme SA' });
      expect(screen.getByText('Acme SA')).toBeInTheDocument();
      expect(screen.queryByLabelText(/buscar cliente/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cambiar/i })).toBeInTheDocument();
    });
  });

  describe('tipo de comprobante', () => {
    it('defaults to "Nota de venta" and switches to "Factura" via onDocumentTypeChange', () => {
      const { onDocumentTypeChange } = renderModal(EMPTY_CART);
      expect(screen.getByLabelText('Nota de venta')).toBeChecked();
      fireEvent.click(screen.getByLabelText('Factura'));
      expect(onDocumentTypeChange).toHaveBeenCalledWith('invoice');
    });
  });

  it('searches GET /products?q= (debounced) and adds a single-variant product at maxPrice', async () => {
    const { onCartUpdated } = renderModal();
    vi.useFakeTimers();
    mockedFetch.mockResolvedValueOnce({ data: [{ id: 'prod-1', name: 'Blender' }] });
    fireEvent.change(screen.getByLabelText(/buscar producto/i), { target: { value: 'blen' } });
    expect(mockedFetch).not.toHaveBeenCalled();

    // advanceTimersByTimeAsync also flushes the microtask queue in between — required since the
    // debounced search awaits the (otherwise fake-timer-frozen) mocked apiFetch promise.
    await vi.advanceTimersByTimeAsync(350);
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products', { query: { q: 'blen', status: 'active', pageSize: 8 } });
    // Switch back to real timers before the remaining, non-debounced interactions — mixing fake
    // timers with Testing Library's own polling `waitFor` would hang. The React state update from
    // the just-resolved search promise may still be one microtask tick away, so re-check "Blender"
    // through `waitFor` rather than a synchronous `getByText`.
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Blender')).toBeInTheDocument());

    mockedFetch.mockResolvedValueOnce([
      { id: 'var-1', productId: 'prod-1', sku: 'SKU-1', unit: 'un', maxPrice: 15, basePrice: 10, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' },
    ]);
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 10 }] }); // picker's own stock check
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 10 }] }); // addVariant's re-check
    mockedFetch.mockResolvedValueOnce(CART_WITH_LINE);
    fireEvent.click(screen.getByRole('button', { name: 'Blender' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items', {
        method: 'POST',
        body: { productVariantId: 'var-1', quantity: 1, negotiatedUnitPrice: 15 },
      }),
    );
    expect(onCartUpdated).toHaveBeenCalledWith(CART_WITH_LINE);
  });

  it('selects a product by clicking anywhere on its result row, not just a dedicated button', async () => {
    renderModal();
    const row = await pickFirstResultAfterSearch('Blender', 'prod-1');
    // `row` IS the whole result row — the row itself is the clickable element now, there is no
    // separate "Elegir" button beside it.
    mockedFetch.mockResolvedValueOnce([
      { id: 'var-1', productId: 'prod-1', sku: 'SKU-1', unit: 'un', maxPrice: 15, basePrice: 10, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' },
    ]);
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 10 }] });
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 10 }] });
    mockedFetch.mockResolvedValueOnce(CART_WITH_LINE);
    // Click a child node inside the row (the chevron), not the row element itself — proves the
    // whole row area is the hit target via bubbling, exactly like clicking anywhere on it.
    fireEvent.click(row.querySelector('[aria-hidden="true"]') ?? row);
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items', {
        method: 'POST',
        body: { productVariantId: 'var-1', quantity: 1, negotiatedUnitPrice: 15 },
      }),
    );
  });

  it('shows a variant picker for a multi-variant product, each with its own stock, and adds the chosen one', async () => {
    renderModal();
    // Drives the variant picker directly, bypassing the search debounce (covered separately above).
    // The search mock must be queued and consumed first — queuing the variants mock before it
    // would hand the search call a raw variants array instead of `{ data: [...] }`.
    const chooseButton = await pickFirstResultAfterSearch('Shirt', 'prod-1');
    mockedFetch.mockResolvedValueOnce([
      { id: 'var-1', productId: 'prod-1', sku: 'SKU-S', unit: 'un', maxPrice: 10, basePrice: 8, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' },
      { id: 'var-2', productId: 'prod-1', sku: 'SKU-M', unit: 'un', maxPrice: 12, basePrice: 9, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' },
    ]);
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 3 }] }); // var-1 stock
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 7 }] }); // var-2 stock
    fireEvent.click(chooseButton);
    await screen.findByText('SKU-M');
    expect(screen.getByText('Stock disponible: 3')).toBeInTheDocument();
    expect(screen.getByText('Stock disponible: 7')).toBeInTheDocument();

    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 7 }] }); // addVariant's re-check for var-2
    mockedFetch.mockResolvedValueOnce(CART_WITH_LINE);
    fireEvent.click(screen.getAllByRole('button', { name: /agregar/i })[1]!);
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items', {
        method: 'POST',
        body: { productVariantId: 'var-2', quantity: 1, negotiatedUnitPrice: 12 },
      }),
    );
  });

  it('dims a zero-stock variant and disables its "Agregar" button — it cannot be selected', async () => {
    renderModal();
    const chooseButton = await pickFirstResultAfterSearch('Shirt', 'prod-1');
    mockedFetch.mockResolvedValueOnce([
      { id: 'var-1', productId: 'prod-1', sku: 'SKU-S', unit: 'un', maxPrice: 10, basePrice: 8, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' },
      { id: 'var-2', productId: 'prod-1', sku: 'SKU-M', unit: 'un', maxPrice: 12, basePrice: 9, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' },
    ]);
    mockedFetch.mockResolvedValueOnce({ data: [] }); // var-1: zero stock
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 4 }] }); // var-2: in stock
    fireEvent.click(chooseButton);
    await screen.findByText('SKU-M');

    expect(screen.getByText('Sin stock disponible')).toBeInTheDocument();
    const addButtons = screen.getAllByRole('button', { name: /agregar/i });
    expect(addButtons[0]).toBeDisabled();
    expect(addButtons[1]).toBeEnabled();
  });

  it('does not auto-add a single-variant product with zero stock — shows it dimmed instead', async () => {
    renderModal();
    const chooseButton = await pickFirstResultAfterSearch('Blender', 'prod-1');
    mockedFetch.mockResolvedValueOnce([
      { id: 'var-1', productId: 'prod-1', sku: 'SKU-1', unit: 'un', maxPrice: 15, basePrice: 10, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' },
    ]);
    mockedFetch.mockResolvedValueOnce({ data: [] }); // zero stock
    fireEvent.click(chooseButton);

    expect(await screen.findByText('Sin stock disponible')).toBeInTheDocument();
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/cart/items')).toHaveLength(0);
  });

  it('resolves a QR code to a variant and adds it, after re-checking stock', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /escanear qr/i }));
    fireEvent.change(screen.getByLabelText(/código qr/i), { target: { value: 'ABC123' } });

    mockedFetch.mockResolvedValueOnce({ qrCodeId: 'qr-1', targetType: 'product_variant', productId: 'prod-1', productVariantId: 'var-1', status: 'active' });
    mockedFetch.mockResolvedValueOnce({ id: 'var-1', productId: 'prod-1', sku: 'SKU-1', unit: 'un', maxPrice: 15, basePrice: 10, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' });
    mockedFetch.mockResolvedValueOnce({ data: [{ quantityAvailable: 10 }] });
    mockedFetch.mockResolvedValueOnce(CART_WITH_LINE);
    fireEvent.click(screen.getByRole('button', { name: /resolver/i }));

    await waitFor(() => expect(mockedFetch).toHaveBeenNthCalledWith(1, '/api/v1/qr-codes/resolve/ABC123'));
    await waitFor(() => expect(mockedFetch).toHaveBeenNthCalledWith(2, '/api/v1/products/prod-1/variants/var-1'));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenNthCalledWith(3, '/api/v1/inventory/balances', {
        query: { productVariantId: 'var-1', locationId: 'loc-1', pageSize: 1 },
      }),
    );
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenNthCalledWith(4, '/api/v1/cart/items', {
        method: 'POST',
        body: { productVariantId: 'var-1', quantity: 1, negotiatedUnitPrice: 15 },
      }),
    );
    await screen.findByText(/agregado: sku-1/i);
  });

  it('blocks adding via QR when the resolved variant has zero stock', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /escanear qr/i }));
    fireEvent.change(screen.getByLabelText(/código qr/i), { target: { value: 'ABC123' } });

    mockedFetch.mockResolvedValueOnce({ qrCodeId: 'qr-1', targetType: 'product_variant', productId: 'prod-1', productVariantId: 'var-1', status: 'active' });
    mockedFetch.mockResolvedValueOnce({ id: 'var-1', productId: 'prod-1', sku: 'SKU-1', unit: 'un', maxPrice: 15, basePrice: 10, status: 'active', isSerialized: false, isLotTracked: false, attributes: {}, createdAt: '', updatedAt: '' });
    mockedFetch.mockResolvedValueOnce({ data: [] });
    fireEvent.click(screen.getByRole('button', { name: /resolver/i }));

    expect(await screen.findByText(/sku-1 no tiene stock disponible/i)).toBeInTheDocument();
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/cart/items')).toHaveLength(0);
  });

  it('shows a safe message for a QR pointing at a location, not a product', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /escanear qr/i }));
    fireEvent.change(screen.getByLabelText(/código qr/i), { target: { value: 'LOC1' } });
    mockedFetch.mockResolvedValueOnce({ qrCodeId: 'qr-1', targetType: 'location', locationId: 'loc-9', status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: /resolver/i }));
    expect(await screen.findByText(/corresponde a un almacén/i)).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a revoked/expired QR (410) distinctly', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /escanear qr/i }));
    fireEvent.change(screen.getByLabelText(/código qr/i), { target: { value: 'GONE' } });
    mockedFetch.mockRejectedValueOnce(new ApiError(410, 'GONE', 'expired', undefined));
    fireEvent.click(screen.getByRole('button', { name: /resolver/i }));
    expect(await screen.findByText(/revocado o expiró/i)).toBeInTheDocument();
  });

  it('increments/decrements quantity via PATCH', async () => {
    renderModal(CART_WITH_LINE);
    mockedFetch.mockResolvedValueOnce({ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, quantity: 3 }] });
    fireEvent.click(screen.getByRole('button', { name: /aumentar cantidad de sku-1/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items/ci-1', { method: 'PATCH', body: { quantity: 3 } }),
    );

    mockedFetch.mockResolvedValueOnce({ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, quantity: 1 }] });
    fireEvent.click(screen.getByRole('button', { name: /disminuir cantidad de sku-1/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items/ci-1', { method: 'PATCH', body: { quantity: 1 } }),
    );
  });

  it('disables + once quantity reaches availableAtLocation, and disables − at quantity 1', () => {
    renderModal({ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, quantity: 5, availableAtLocation: 5 }] });
    expect(screen.getByRole('button', { name: /aumentar cantidad de sku-1/i })).toBeDisabled();

    cleanup();
    renderModal({ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, quantity: 1 }] });
    expect(screen.getByRole('button', { name: /disminuir cantidad de sku-1/i })).toBeDisabled();
  });

  it('removes a line via × (DELETE)', async () => {
    renderModal(CART_WITH_LINE);
    mockedFetch.mockResolvedValueOnce(EMPTY_CART);
    fireEvent.click(screen.getByRole('button', { name: /quitar sku-1/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items/ci-1', { method: 'DELETE' }));
  });

  it('edits the price within range via PATCH, and rejects above maxPrice client-side without a request', async () => {
    renderModal(CART_WITH_LINE);
    const priceInput = screen.getByLabelText(/precio para sku-1/i);

    mockedFetch.mockResolvedValueOnce(CART_WITH_LINE);
    fireEvent.change(priceInput, { target: { value: '12' } });
    fireEvent.blur(priceInput);
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/cart/items/ci-1', {
        method: 'PATCH',
        body: { negotiatedUnitPrice: 12 },
      }),
    );

    mockedFetch.mockClear();
    fireEvent.change(priceInput, { target: { value: '99' } });
    fireEvent.blur(priceInput);
    expect(await screen.findByText(/no puede superar el máximo autorizado/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('allows a below-minimum price through (existing below_base/approval flow), bordering the line with "Pendiente Aprobación"', () => {
    renderModal({ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, unitPrice: 5, minPrice: 8 }] });
    expect(screen.getByText('Pendiente Aprobación')).toBeInTheDocument();
  });

  it('shows the label for a price between min and base too (owner policy change: trigger is base_price, not min_price)', () => {
    // CART_WITH_LINE: basePrice 10, minPrice 8 — 9 is above min but below base.
    renderModal({ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, unitPrice: 9 }] });
    expect(screen.getByText('Pendiente Aprobación')).toBeInTheDocument();
  });

  it('shows no "Pendiente Aprobación" label for a price at or above base', () => {
    renderModal(CART_WITH_LINE); // unitPrice 15 >= basePrice 10
    expect(screen.queryByText('Pendiente Aprobación')).not.toBeInTheDocument();
  });

  it('shows the base price on every line', () => {
    renderModal(CART_WITH_LINE); // basePrice 10
    expect(screen.getByText(/Base: \$10\.00/)).toBeInTheDocument();
  });

  it('never shows a separate "Variante" line (owner removed it)', () => {
    renderModal(CART_WITH_LINE);
    expect(screen.queryByText(/Variante:/)).not.toBeInTheDocument();
  });

  it('borders a below-base line in soft red, with no border otherwise', () => {
    const { container } = render(
      <ProductCartModal
        open
        onClose={vi.fn()}
        cart={{ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, unitPrice: 5 }] }}
        canViewProducts
        onCartUpdated={vi.fn()}
        customerLabel={null}
        selectedCustomer={null}
        canSearchCustomers
        canManageCustomers
        onSelectCustomer={vi.fn()}
        documentType="sales_note"
        onDocumentTypeChange={vi.fn()}
        onCheckout={vi.fn()}
      />,
    );
    expect(container.querySelector('li.border-red-200')).not.toBeNull();

    cleanup();
    const { container: containerWithinRange } = render(
      <ProductCartModal
        open
        onClose={vi.fn()}
        cart={CART_WITH_LINE}
        canViewProducts
        onCartUpdated={vi.fn()}
        customerLabel={null}
        selectedCustomer={null}
        canSearchCustomers
        canManageCustomers
        onSelectCustomer={vi.fn()}
        documentType="sales_note"
        onDocumentTypeChange={vi.fn()}
        onCheckout={vi.fn()}
      />,
    );
    expect(containerWithinRange.querySelector('li.border-red-200')).toBeNull();
  });

  it('shows a product thumbnail once GET /products/:id/images resolves, and a placeholder before/without one', async () => {
    mockedFetch.mockResolvedValueOnce([{ id: 'img-1', productId: 'prod-1', position: 0, createdAt: '', url: '/api/v1/products/prod-1/images/img-1' }]);
    const { container } = renderModal(CART_WITH_LINE);
    // Decorative (alt="", like ProductsCatalogTable's own thumbnail) — not in the accessibility
    // tree by design, so queried via the DOM directly rather than getByRole.
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/v1/products/prod-1/images/img-1');
  });

  it('keeps the placeholder icon when the product has no images', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    const { container } = renderModal(CART_WITH_LINE);
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/prod-1/images'));
    expect(container.querySelector('img')).toBeNull();
  });

  describe('Crear pedido', () => {
    it('is disabled without a customer, enabled with one and sellable lines — no payment method asked here', () => {
      const { customerId, ...cartWithoutCustomer } = CART_WITH_LINE;
      void customerId;
      renderModal(cartWithoutCustomer);
      expect(screen.getByRole('button', { name: /crear pedido/i })).toBeDisabled();
      expect(screen.queryByText(/forma de pago/i)).not.toBeInTheDocument();

      cleanup();
      renderModal(CART_WITH_LINE);
      expect(screen.getByRole('button', { name: /crear pedido/i })).toBeEnabled();

      cleanup();
      renderModal({ ...CART_WITH_LINE, items: [{ ...CART_WITH_LINE.items[0]!, sellable: false }] });
      expect(screen.getByRole('button', { name: /crear pedido/i })).toBeDisabled();

      cleanup();
      renderModal(EMPTY_CART);
      expect(screen.getByRole('button', { name: /crear pedido/i })).toBeDisabled();
    });

    it('calls onCheckout with no arguments', async () => {
      const { onCheckout } = renderModal(CART_WITH_LINE);
      fireEvent.click(screen.getByRole('button', { name: /crear pedido/i }));
      await waitFor(() => expect(onCheckout).toHaveBeenCalledWith());
    });

    it('shows the error inline when onCheckout rejects, instead of it disappearing behind the overlay', async () => {
      const onCheckout = vi.fn().mockRejectedValue(new ApiError(422, 'UNPROCESSABLE_ENTITY', 'Customer is missing data.', undefined));
      renderModal(CART_WITH_LINE, { onCheckout });
      fireEvent.click(screen.getByRole('button', { name: /crear pedido/i }));
      expect(await screen.findByText(/customer is missing data/i)).toBeInTheDocument();
    });
  });

  it('never writes to browser storage', async () => {
    renderModal(CART_WITH_LINE);
    mockedFetch.mockResolvedValueOnce(EMPTY_CART);
    fireEvent.click(screen.getByRole('button', { name: /quitar sku-1/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

/** Drives the search box with real timers (the debounce path itself is covered by the dedicated
 * fake-timer test above) by resolving instantly — used only to get to the variant-picker UI. */
async function pickFirstResultAfterSearch(productName: string, productId: string): Promise<HTMLElement> {
  mockedFetch.mockResolvedValueOnce({ data: [{ id: productId, name: productName }] });
  fireEvent.change(screen.getByLabelText(/buscar producto/i), { target: { value: productName } });
  await screen.findByText(productName);
  return screen.getByRole('button', { name: productName });
}
