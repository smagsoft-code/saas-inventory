'use client';
import { HelpTip } from '../../../../components/ui/help-tip';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { cn } from '../../../../lib/cn';
import type { Variant } from '../../../../lib/types/products';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  customerMissingCommercialData,
  type Cart,
  type CartItem,
  type Customer,
  type DocumentType,
} from '../../../../lib/types/sales';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Modal } from '../../../../components/ui/modal';
import { CreateCustomerModal } from './create-customer-modal';
import {
  getStockAvailable,
  getVariant,
  listProductImages,
  listVariants,
  resolveQrCode,
  searchProducts,
  type ProductSearchResult,
} from './sale-api';

const SEARCH_DEBOUNCE_MS = 350;

/** A search result row that has expanded into its variants — distinct from the product row
 * itself, which is keyed by `productId`. `stockByVariantId` is resolved up front (one
 * `GET /inventory/balances` per variant, at the cart's own location) so a zero-stock variant can
 * be shown dimmed and unselectable *before* anyone tries to add it. */
interface ExpandedVariants {
  productId: string;
  variants: Variant[];
  stockByVariantId: Record<string, number>;
}

/**
 * The one-stop "Nueva venta" window — a `Modal` (OUI responsive: bottom-sheet on mobile, centered
 * panel from `sm` up) covering cliente → tipo de comprobante → productos, ending in "Crear pedido"
 * (owner redesign: collapses what used to be a separate checkout step into this same window,
 * avoiding an extra navigation). Every cart line mutation goes straight through the backend's own
 * `/cart` resource (`onCartUpdated` just replaces the parent's copy of the server response) —
 * there is no parallel client-side cart, so opening/closing this modal never loses anything: the
 * next open just renders whatever `cart` currently is. `onCheckout` is the one exception — it's a
 * real `POST /orders` the parent owns (so it can redirect to the resulting order), but this
 * component drives *when* it fires and displays its own busy/error state. The payment method is
 * deliberately NOT asked here — it's picked at confirm, on the order's own detail page, once any
 * exceptional-discount line has cleared approval (owner redesign). */
export function ProductCartModal({
  open,
  onClose,
  cart,
  locationLabel,
  canViewProducts,
  onCartUpdated,
  customerLabel,
  selectedCustomer,
  canSearchCustomers,
  canManageCustomers,
  onSelectCustomer,
  documentType,
  onDocumentTypeChange,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  cart: Cart;
  /** "Sucursal · Almacén" the sale is made from — shown next to the window title. */
  locationLabel?: string;
  canViewProducts: boolean;
  onCartUpdated: (cart: Cart) => void;
  customerLabel: string | null;
  selectedCustomer: Customer | null;
  canSearchCustomers: boolean;
  canManageCustomers: boolean;
  onSelectCustomer: (customer: Customer) => Promise<void>;
  documentType: DocumentType;
  onDocumentTypeChange: (type: DocumentType) => void;
  /** "Crear pedido" — throws on failure so this component can show the error inline instead of it
   * disappearing behind the modal's own overlay. */
  onCheckout: () => Promise<void>;
}): React.JSX.Element {
  const [tab, setTab] = useState<'search' | 'qr'>('search');

  // --- customer -------------------------------------------------------------------------------
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefillTaxId, setCreatePrefillTaxId] = useState('');
  const skipNextCustomerDebounce = useRef(true);

  const missingCustomerData = selectedCustomer ? customerMissingCommercialData(selectedCustomer) : [];

  useEffect(() => {
    if (skipNextCustomerDebounce.current) {
      skipNextCustomerDebounce.current = false;
      return;
    }
    const q = customerQuery.trim();
    if (!q) {
      setCustomerResults([]);
      setCustomerSearching(false);
      return;
    }
    setCustomerSearching(true);
    const timer = setTimeout(() => {
      apiFetch<{ data: Customer[] }>('/api/v1/customers', { query: { q, pageSize: 10 } })
        .then((page) => setCustomerResults(page.data))
        .catch(() => setCustomerResults([]))
        .finally(() => setCustomerSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  async function chooseCustomer(customer: Customer): Promise<void> {
    if (customerBusy) {
      return;
    }
    setCustomerBusy(true);
    setError(null);
    try {
      await onSelectCustomer(customer);
      setCustomerPanelOpen(false);
      setCustomerResults([]);
      setCustomerQuery('');
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setCustomerBusy(false);
    }
  }

  function onCustomerSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') {
      return;
    }
    const q = customerQuery.trim();
    if (!q || customerSearching || customerResults.length > 0) {
      return;
    }
    event.preventDefault();
    setCreatePrefillTaxId(q);
    setCreateOpen(true);
  }

  // --- products / QR --------------------------------------------------------------------------

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const skipNextDebounce = useRef(true);

  const [expanded, setExpanded] = useState<ExpandedVariants | null>(null);
  const [variantsLoading, setVariantsLoading] = useState<string | null>(null);

  const [qrCode, setQrCode] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const [qrMessage, setQrMessage] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  // One thumbnail lookup per distinct product already in the cart — `undefined` key = not fetched
  // yet, `null` value = fetched but the product has no image. Keyed by productId (not line id) so
  // two lines of the same product never double-fetch.
  const [thumbnailByProductId, setThumbnailByProductId] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const missing = [...new Set(cart.items.map((i) => i.productId))].filter(
      (id) => id && !(id in thumbnailByProductId),
    );
    if (missing.length === 0) {
      return;
    }
    for (const productId of missing) {
      void listProductImages(productId)
        .then((images) => {
          // Computed here, synchronously inside the settled callback — never inside the setState
          // updater below, where a throw would escape past this function's own try/catch (it runs
          // later, during React's own reducer invocation) and surface as an unhandled rejection.
          const url = Array.isArray(images) && images.length > 0 ? images[0]!.url : null;
          setThumbnailByProductId((cur) => ({ ...cur, [productId]: url }));
        })
        .catch(() => setThumbnailByProductId((cur) => ({ ...cur, [productId]: null })));
    }
    // Only re-runs when the cart's own items change — not on `thumbnailByProductId` itself, which
    // would loop (no `react-hooks/exhaustive-deps` in this project's lint config to suppress —
    // deliberate, same as `TransferForm`'s equivalent effect).
  }, [cart.items]);

  // Debounced product search — the same 350ms convention `CustomersSearch`/`ProductsFilters` use.
  useEffect(() => {
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchProducts(q, cart.locationId)
        .then((rows) => setResults(rows))
        .catch((err: unknown) => setError(httpErrorMessage(err)))
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, cart.locationId]);

  const inCartVariantIds = new Set(cart.items.map((i) => i.productVariantId));

  function applyCart(next: Cart): void {
    onCartUpdated(next);
    setError(null);
  }

  async function run(key: string, request: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(key);
    setError(null);
    try {
      await request();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  /** Adds one unit of `variant`. Already-in-cart variant: omit `negotiatedUnitPrice` so the
   * backend's upsert only increments quantity and leaves whatever price is already there — never
   * resets an edited price back to `maxPrice` on a second scan/search hit. A brand-new line sends
   * `negotiatedUnitPrice: variant.maxPrice` — the owner's rule "precio inicial = precio máximo",
   * sourced from the backend's own `VariantResponseDto`, never computed locally. */
  async function addVariant(variant: Variant): Promise<void> {
    const alreadyInCart = inCartVariantIds.has(variant.id);
    await run(`add-${variant.id}`, async () => {
      // Re-checked here too (not just in the picker's own display) — stock can change between
      // listing it and clicking it, and this is also the only gate the QR path goes through.
      const stock = await getStockAvailable(variant.id, cart.locationId);
      if (stock <= 0) {
        setError(`${variant.sku} no tiene stock disponible en este almacén.`);
        return;
      }
      const body: Record<string, unknown> = { productVariantId: variant.id, quantity: 1 };
      if (!alreadyInCart) {
        body['negotiatedUnitPrice'] = variant.maxPrice;
      }
      const updated = await apiFetch<Cart>('/api/v1/cart/items', { method: 'POST', body });
      applyCart(updated);
      setExpanded(null);
      setResults([]);
      setQuery('');
    });
  }

  async function onPickProduct(product: ProductSearchResult): Promise<void> {
    setError(null);
    setVariantsLoading(product.id);
    try {
      const variants = await listVariants(product.id);
      const sellable = variants.filter((v) => v.status === 'active');
      const stockEntries = await Promise.all(
        sellable.map(async (v): Promise<[string, number]> => [v.id, await getStockAvailable(v.id, cart.locationId)]),
      );
      const stockByVariantId = Object.fromEntries(stockEntries);
      if (sellable.length === 1 && stockByVariantId[sellable[0]!.id]! > 0) {
        await addVariant(sellable[0]!);
        return;
      }
      setExpanded({ productId: product.id, variants: sellable, stockByVariantId });
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setVariantsLoading(null);
    }
  }

  // --- QR -----------------------------------------------------------------------------------
  // Decoupled from any camera: today this is a manual code entry, resolved through the same
  // `resolveQrCode` → `getVariant` → add-to-cart pipeline a real scanner would feed. Swapping in a
  // camera later only needs to call `onQrDecoded(code)` instead of submitting this form — nothing
  // else here changes.

  async function onQrDecoded(code: string): Promise<void> {
    if (!code.trim()) {
      return;
    }
    setQrMessage(null);
    setQrBusy(true);
    try {
      const identity = await resolveQrCode(code.trim());
      if (identity.targetType !== 'product_variant' || !identity.productId || !identity.productVariantId) {
        setQrMessage('Este código corresponde a un almacén, no a un producto.');
        return;
      }
      if (identity.status !== 'active') {
        setQrMessage('La variante de este código ya no está activa.');
        return;
      }
      const variant = await getVariant(identity.productId, identity.productVariantId);
      await addVariant(variant);
      setQrMessage(`Agregado: ${variant.sku}.`);
      setQrCode('');
    } catch (err) {
      if (isApiError(err) && err.status === 404) {
        setQrMessage('Código QR no encontrado.');
      } else if (isApiError(err) && err.status === 410) {
        setQrMessage('Este código QR fue revocado o expiró.');
      } else {
        setQrMessage(httpErrorMessage(err));
      }
    } finally {
      setQrBusy(false);
    }
  }

  function onQrSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onQrDecoded(qrCode);
  }

  // --- lines ----------------------------------------------------------------------------------

  async function setLineQuantity(item: CartItem, nextQuantity: number): Promise<void> {
    if (nextQuantity < 1) {
      return;
    }
    await run(`qty-${item.id}`, async () => {
      const updated = await apiFetch<Cart>(`/api/v1/cart/items/${item.id}`, {
        method: 'PATCH',
        body: { quantity: nextQuantity },
      });
      applyCart(updated);
    });
  }

  async function setLinePrice(item: CartItem, value: string): Promise<void> {
    const price = Number(value);
    if (value.trim() === '' || !Number.isFinite(price) || price < 0) {
      return;
    }
    if (price > item.maxPrice) {
      setError(`El precio no puede superar el máximo autorizado (${item.maxPrice.toFixed(2)}).`);
      return;
    }
    await run(`price-${item.id}`, async () => {
      const updated = await apiFetch<Cart>(`/api/v1/cart/items/${item.id}`, {
        method: 'PATCH',
        body: { negotiatedUnitPrice: price },
      });
      applyCart(updated);
    });
  }

  async function removeLine(item: CartItem): Promise<void> {
    await run(`remove-${item.id}`, async () => {
      const updated = await apiFetch<Cart>(`/api/v1/cart/items/${item.id}`, { method: 'DELETE' });
      applyCart(updated);
    });
  }

  // --- checkout ------------------------------------------------------------------------------

  const unsellableLines = cart.items.filter((i) => !i.sellable);
  const canCheckout = cart.items.length > 0 && unsellableLines.length === 0 && Boolean(cart.customerId) && busy === null && !checkoutBusy;

  async function handleCheckout(): Promise<void> {
    if (!canCheckout || checkoutBusy) {
      return;
    }
    setCheckoutBusy(true);
    setError(null);
    try {
      await onCheckout();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva venta"
      {...(locationLabel ? { subtitle: locationLabel } : {})}
      size="xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            {!cart.customerId && <p className="text-amber-700">Elige un cliente para continuar.</p>}
          </div>
          <Button type="button" loading={checkoutBusy} disabled={!canCheckout} onClick={() => void handleCheckout()}>
            Crear pedido
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        {/* --- Cliente -------------------------------------------------------------------- */}
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Cliente</h3>
          {cart.customerId && !customerPanelOpen ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-slate-700">{customerLabel ?? 'Seleccionado'}</p>
              {canSearchCustomers && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setCustomerPanelOpen(true)}>
                  Cambiar
                </Button>
              )}
            </div>
          ) : (
            canSearchCustomers && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    type="search"
                    aria-label="Buscar cliente"
                    placeholder="Nombre, identificación, correo o teléfono"
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    onKeyDown={onCustomerSearchKeyDown}
                    className="flex-1"
                  />
                  {canManageCustomers && (
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Crear cliente nuevo"
                      disabled={customerBusy}
                      onClick={() => {
                        setCreatePrefillTaxId(customerQuery.trim());
                        setCreateOpen(true);
                      }}
                      className="shrink-0 px-3"
                    >
                      +
                    </Button>
                  )}
                </div>
                {customerSearching && <p className="text-xs text-slate-500">Buscando…</p>}
                {!customerSearching && customerQuery.trim() && customerResults.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Ningún cliente coincide con esa búsqueda — presiona Enter o el botón "+" para crearlo.
                  </p>
                )}
                {customerResults.length > 0 && (
                  <ul className="flex flex-col divide-y divide-slate-100">
                    {customerResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={customerBusy}
                          onClick={() => void chooseCustomer(c)}
                          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="text-sm">
                            <span className="font-medium text-slate-900">{c.displayName}</span>
                            {c.taxId && <span className="text-slate-500"> · {c.taxId}</span>}
                            {c.email && <span className="text-slate-500"> · {c.email}</span>}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ›
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          )}
          {missingCustomerData.length > 0 && (
            <Alert tone="warning">
              A este cliente le falta {missingCustomerData.join(', ')}. El cierre de venta fallará hasta que se
              complete.
            </Alert>
          )}
        </div>

        {/* --- Tipo de comprobante --------------------------------------------------------- */}
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Tipo de comprobante</h3>
          <fieldset className="flex gap-4">
            <legend className="sr-only">Tipo de documento</legend>
            {DOCUMENT_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="documentType"
                  value={t}
                  checked={documentType === t}
                  onChange={() => onDocumentTypeChange(t)}
                  className="h-4 w-4"
                />
                {DOCUMENT_TYPE_LABELS[t]}
              </label>
            ))}
          </fieldset>
        </div>

        {!canViewProducts && <Alert tone="warning">No puedes listar productos — pide a un administrador ese permiso.</Alert>}

        {canViewProducts && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={tab === 'search' ? 'primary' : 'ghost'}
                onClick={() => setTab('search')}
              >
                Buscar producto
              </Button>
              <Button type="button" size="sm" variant={tab === 'qr' ? 'primary' : 'ghost'} onClick={() => setTab('qr')}>
                Escanear QR
              </Button>
            </div>

            {tab === 'search' ? (
              <div className="flex flex-col gap-2">
                <Input
                  type="search"
                  aria-label="Buscar producto"
                  placeholder="Nombre, SKU o código de barras"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {searching && <p className="text-xs text-slate-500">Buscando…</p>}
                {!searching && query.trim() && results.length === 0 && (
                  <p className="text-sm text-slate-500">Ningún producto coincide con esa búsqueda.</p>
                )}
                {results.length > 0 && (
                  <ul className="flex flex-col divide-y divide-slate-100">
                    {results.map((product, index) => (
                      <li key={product.variantId}>
                        {/* The whole row is the hit target — clicking anywhere on it (not just a
                         * separate button) selects the product, same pattern as the customer
                         * search above. */}
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void onPickProduct(product)}
                          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-xs font-medium text-slate-900">{product.name}</span>
                            <span className="text-[11px] text-slate-500">{product.sku}</span>
                          </span>
                          {variantsLoading === product.id ? (
                            <span className="text-xs text-slate-500">Cargando…</span>
                          ) : (
                            <span aria-hidden="true" className="text-slate-400">
                              ›
                            </span>
                          )}
                        </button>
                        {/* A product with several matching variants appears once per variant; its variant
                         * list opens under the first of those rows only. */}
                        {expanded?.productId === product.id && results.findIndex((r) => r.id === product.id) === index && (
                          <ul className="mt-2 flex flex-col gap-1 pl-3">
                            {expanded.variants.length === 0 && (
                              <li className="text-xs text-slate-500">Sin variantes vendibles.</li>
                            )}
                            {expanded.variants.map((variant) => {
                              const stock = expanded.stockByVariantId[variant.id] ?? 0;
                              const outOfStock = stock <= 0;
                              return (
                                <li
                                  key={variant.id}
                                  className={cn('flex items-center justify-between gap-2', outOfStock && 'opacity-50')}
                                >
                                  <span>
                                    <span className={cn('text-sm', outOfStock ? 'text-slate-400' : 'text-slate-700')}>
                                      {variant.sku}
                                    </span>
                                    <span className="block text-xs text-slate-400">
                                      {outOfStock ? 'Sin stock disponible' : `Stock disponible: ${stock}`}
                                    </span>
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    loading={busy === `add-${variant.id}`}
                                    disabled={busy !== null || outOfStock}
                                    onClick={() => void addVariant(variant)}
                                  >
                                    Agregar
                                  </Button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <form onSubmit={onQrSubmit} className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    aria-label="Código QR"
                    placeholder="Ingresa o escanea el código"
                    value={qrCode}
                    onChange={(e) => setQrCode(e.target.value)}
                  />
                  <Button type="submit" size="sm" loading={qrBusy} disabled={busy !== null || !qrCode.trim()}>
                    Resolver
                  </Button>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  Entrada manual
                  <HelpTip>
                    Entrada manual por ahora — la misma resolución quedará lista para un lector de cámara más adelante.
                  </HelpTip>
                </p>
                {qrMessage && <p className="text-sm text-slate-700">{qrMessage}</p>}
              </form>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Productos</h3>
          {cart.items.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no hay productos — busca o escanea uno arriba.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {cart.items.map((item) => (
                <CartLineRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  thumbnailUrl={thumbnailByProductId[item.productId] ?? null}
                  onIncrement={() => void setLineQuantity(item, item.quantity + 1)}
                  onDecrement={() => void setLineQuantity(item, item.quantity - 1)}
                  onPriceCommit={(value) => void setLinePrice(item, value)}
                  onRemove={() => void removeLine(item)}
                />
              ))}
            </ul>
          )}
          {unsellableLines.length > 0 && (
            <Alert tone="error">Quita los productos marcados «no vendible» antes de continuar.</Alert>
          )}
          <p className="ml-auto flex items-center gap-2 rounded-md bg-green-600 px-3 py-1.5 text-sm text-white">
            Subtotal <span className="font-semibold">${cart.subtotal.toFixed(2)}</span>
          </p>
        </div>
      </div>

      <CreateCustomerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initialTaxId={createPrefillTaxId}
        onCreated={(customer) => void chooseCustomer(customer)}
      />
    </Modal>
  );
}

function CartLineRow({
  item,
  busy,
  thumbnailUrl,
  onIncrement,
  onDecrement,
  onPriceCommit,
  onRemove,
}: {
  item: CartItem;
  busy: string | null;
  thumbnailUrl: string | null;
  onIncrement: () => void;
  onDecrement: () => void;
  onPriceCommit: (value: string) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const atMax = item.quantity >= item.availableAtLocation;
  // Owner policy change: the exceptional-discount trigger is now `basePrice`, not `minPrice` —
  // `basePrice` is never permission-gated, so this shows for every caller, not just one with
  // `pricing.floor.view`.
  const belowBase = item.unitPrice < item.basePrice;

  return (
    <li
      className={cn(
        'relative rounded-lg px-2 py-2',
        belowBase && 'border border-red-200 bg-red-50/60 pt-3',
      )}
    >
      {belowBase && (
        // Sits directly on the box's own top border (fieldset/legend technique) — the opaque
        // background masks the border line behind the text, so the border reads as "broken" right
        // where the label sits, instead of a second line drawn below it.
        <span
          title="El precio está debajo del precio base — un supervisor o administrador deberá aprobarlo antes de confirmar el pedido."
          className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 bg-red-50 px-2 text-xs font-semibold text-red-600"
        >
          Pendiente Aprobación
        </span>
      )}
      {/* Always a single row, even on mobile (owner requirement) — compact sizing throughout
       * (smaller thumbnail/stepper/price/remove, truncated text) is what makes that fit at ~390px. */}
      <div className="flex items-center gap-2">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-md border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">
            {item.productName}
            {!item.sellable && (
              <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">no vendible</span>
            )}
          </p>
          <p className={cn('truncate text-xs', item.availableAtLocation < item.quantity ? 'text-red-600' : 'text-slate-500')}>
            Stock: {item.availableAtLocation}
          </p>
          <p className="truncate text-xs text-slate-500">Base: ${item.basePrice.toFixed(2)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="primary"
            size="sm"
            aria-label={`Disminuir cantidad de ${item.sku}`}
            disabled={busy !== null || item.quantity <= 1}
            onClick={onDecrement}
            className="h-[22px] w-[22px] px-0"
          >
            −
          </Button>
          <span className="w-5 text-center text-sm text-slate-900">{item.quantity}</span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            aria-label={`Aumentar cantidad de ${item.sku}`}
            disabled={busy !== null || atMax}
            onClick={onIncrement}
            className="h-[22px] w-[22px] px-0"
          >
            +
          </Button>
        </div>

        <span className="flex shrink-0 items-center rounded-md border border-slate-300 bg-white pl-1.5">
          <span className="text-xs text-slate-500">$</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            defaultValue={item.unitPrice.toFixed(2)}
            aria-label={`Precio para ${item.sku}`}
            disabled={busy !== null}
            onBlur={(e) => {
              if (Number(e.target.value) !== item.unitPrice) {
                onPriceCommit(e.target.value);
              }
            }}
            className="w-14 border-0 pl-0.5 pr-1 text-sm"
          />
        </span>

        <Button
          type="button"
          variant="danger"
          size="sm"
          aria-label={`Quitar ${item.sku}`}
          disabled={busy !== null}
          onClick={onRemove}
          className="h-7 w-7 shrink-0 px-0 text-base"
        >
          ×
        </Button>
      </div>
    </li>
  );
}
