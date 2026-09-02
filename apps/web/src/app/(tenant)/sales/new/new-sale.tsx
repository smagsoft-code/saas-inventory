'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  customerMissingCommercialData,
  type Cart,
  type Customer,
  type DocumentType,
  type Order,
} from '../../../../lib/types/sales';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

interface Ref {
  id: string;
  name: string;
}
interface CustomerRef {
  id: string;
  displayName: string;
}
interface VariantOption {
  id: string;
  sku: string;
}

/** A distinct idempotency key per logical checkout attempt — reused across retries of that same
 * attempt, regenerated for a fresh one (mirrors `randomCorrelationId` in the api client). */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * The vendor cart → order flow. The cart is the backend's own singular `/cart` resource (not
 * browser storage): every edit is an `apiFetch` that returns the full updated cart. Checkout is
 * `POST /orders { cartId, documentType }` with a required `Idempotency-Key` header — one key per
 * logical attempt, held across retries. The backend owns pricing, stock reservation and every
 * derived value; the UI only renders what it returns.
 */
export function NewSale({
  initialCart,
  initialCustomer,
  customerIdHint,
  products,
  locations,
  canSearchCustomers,
}: {
  initialCart: Cart | null;
  initialCustomer: CustomerRef | null;
  customerIdHint?: string;
  products: Ref[];
  locations: Ref[];
  canSearchCustomers: boolean;
}): React.JSX.Element {
  const router = useRouter();

  const [cart, setCart] = useState<Cart | null>(initialCart);
  const [customerLabel, setCustomerLabel] = useState<string | null>(initialCustomer?.displayName ?? null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [order, setOrder] = useState<Order | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Start a sale" phase
  const [startLocationId, setStartLocationId] = useState(locations[0]?.id ?? '');

  // Customer search panel
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerSearched, setCustomerSearched] = useState(false);

  // Add-line form
  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [productVariantId, setProductVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [negotiatedPrice, setNegotiatedPrice] = useState('');

  // Checkout
  const [documentType, setDocumentType] = useState<DocumentType>('sales_note');
  const [checkoutKey, setCheckoutKey] = useState('');

  const inCartVariantIds = useMemo(() => new Set((cart?.items ?? []).map((i) => i.productVariantId)), [cart]);

  const missingCustomerData = selectedCustomer ? customerMissingCommercialData(selectedCustomer) : [];
  const unsellableLines = (cart?.items ?? []).filter((i) => !i.sellable);
  const canCheckout =
    cart !== null &&
    cart.items.length > 0 &&
    Boolean(cart.customerId) &&
    unsellableLines.length === 0 &&
    busy === null;

  function applyCart(next: Cart): void {
    setCart(next);
    setError(null);
  }

  function friendlyError(err: unknown): string {
    if (isApiError(err) && err.status === 403) {
      return 'You are not authorized to operate on this location.';
    }
    return httpErrorMessage(err);
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
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  // --- start ---------------------------------------------------------------------------------

  async function startSale(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!startLocationId) {
      setError('Choose the location the sale is made from.');
      return;
    }
    await run('start', async () => {
      const body: Record<string, unknown> = { locationId: startLocationId };
      if (customerIdHint) {
        body['customerId'] = customerIdHint;
      }
      const created = await apiFetch<Cart>('/api/v1/cart', { method: 'POST', body });
      applyCart(created);
    });
  }

  // --- customer -----------------------------------------------------------------------------

  async function searchCustomers(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const q = customerQuery.trim();
    if (!q) {
      return;
    }
    await run('customer-search', async () => {
      const page = await apiFetch<{ data: Customer[] }>('/api/v1/customers', { query: { q, pageSize: 10 } });
      setCustomerResults(page.data);
      setCustomerSearched(true);
    });
  }

  async function chooseCustomer(customer: Customer): Promise<void> {
    if (!cart) {
      return;
    }
    await run('customer-set', async () => {
      const updated = await apiFetch<Cart>('/api/v1/cart', { method: 'PATCH', body: { customerId: customer.id } });
      applyCart(updated);
      setSelectedCustomer(customer);
      setCustomerLabel(customer.displayName);
      setCustomerPanelOpen(false);
      setCustomerResults([]);
      setCustomerSearched(false);
      setCustomerQuery('');
    });
  }

  async function changeLocation(locationId: string): Promise<void> {
    if (!cart || locationId === cart.locationId) {
      return;
    }
    await run('location', async () => {
      const updated = await apiFetch<Cart>('/api/v1/cart', { method: 'PATCH', body: { locationId } });
      applyCart(updated);
    });
  }

  // --- lines --------------------------------------------------------------------------------

  async function onProductChange(nextProductId: string): Promise<void> {
    setProductId(nextProductId);
    setProductVariantId('');
    setVariants([]);
    if (!nextProductId) {
      return;
    }
    setVariantsLoading(true);
    try {
      const rows = await apiFetch<{ id: string; sku: string }[]>(`/api/v1/products/${nextProductId}/variants`);
      setVariants(rows.map((r) => ({ id: r.id, sku: r.sku })));
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setVariantsLoading(false);
    }
  }

  async function addLine(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!cart) {
      return;
    }
    const qty = Number(quantity);
    if (!productVariantId || !Number.isFinite(qty) || qty <= 0) {
      setError('Choose a variant and a quantity greater than zero.');
      return;
    }
    if (inCartVariantIds.has(productVariantId)) {
      setError('That variant is already on the sale — change its quantity in the lines below.');
      return;
    }
    await run('add-line', async () => {
      const body: Record<string, unknown> = { productVariantId, quantity: qty };
      if (negotiatedPrice.trim() !== '' && Number.isFinite(Number(negotiatedPrice))) {
        body['negotiatedUnitPrice'] = Number(negotiatedPrice);
      }
      const updated = await apiFetch<Cart>('/api/v1/cart/items', { method: 'POST', body });
      applyCart(updated);
      setProductId('');
      setVariants([]);
      setProductVariantId('');
      setQuantity('');
      setNegotiatedPrice('');
    });
  }

  async function setLineQuantity(itemId: string, value: string): Promise<void> {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty <= 0) {
      return;
    }
    await run(`qty-${itemId}`, async () => {
      const updated = await apiFetch<Cart>(`/api/v1/cart/items/${itemId}`, { method: 'PATCH', body: { quantity: qty } });
      applyCart(updated);
    });
  }

  async function removeLine(itemId: string): Promise<void> {
    await run(`remove-${itemId}`, async () => {
      const updated = await apiFetch<Cart>(`/api/v1/cart/items/${itemId}`, { method: 'DELETE' });
      applyCart(updated);
    });
  }

  // --- checkout -----------------------------------------------------------------------------

  async function checkout(): Promise<void> {
    if (!cart || !canCheckout) {
      return;
    }
    const key = checkoutKey || newIdempotencyKey();
    if (!checkoutKey) {
      setCheckoutKey(key);
    }
    await run('checkout', async () => {
      const created = await apiFetch<Order>('/api/v1/orders', {
        method: 'POST',
        body: { cartId: cart.id, documentType },
        headers: { 'Idempotency-Key': key },
      });
      setOrder(created);
      setCart(null);
      setCheckoutKey('');
      router.refresh();
    });
  }

  function startAnother(): void {
    setOrder(null);
    setCustomerLabel(null);
    setSelectedCustomer(null);
    setError(null);
    router.refresh();
  }

  // --- render ------------------------------------------------------------------------------

  if (order) {
    const exceptional = order.items.some((i) => i.isExceptionalDiscount);
    return (
      <Card>
        <CardBody className="flex flex-col gap-4">
          <Alert tone="success">
            Order <span className="font-medium">{order.orderNumber}</span> created — status{' '}
            <span className="font-medium">{order.status}</span>. Stock is reserved.
          </Alert>
          {exceptional && (
            <Alert tone="warning">
              One or more lines are below the minimum price. The order needs a price approval before it can be confirmed.
            </Alert>
          )}
          <dl className="grid max-w-sm grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">Customer</dt>
            <dd className="text-slate-900">{order.customer.name}</dd>
            <dt className="text-slate-500">Document</dt>
            <dd className="text-slate-900">{DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType}</dd>
            <dt className="text-slate-500">Total</dt>
            <dd className="text-slate-900">
              {order.total.toFixed(2)} {order.currency}
            </dd>
          </dl>
          <div className="flex gap-2">
            <Link
              href={`/sales/${order.id}`}
              className="inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              View order
            </Link>
            <Button variant="ghost" onClick={startAnother}>
              Start another sale
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (!cart) {
    return (
      <Card>
        <CardBody>
          <form onSubmit={startSale} noValidate className="flex max-w-sm flex-col gap-4">
            <Field label="Location" required hint="Where the sale is made from — it sets stock availability.">
              <Select value={startLocationId} onChange={(e) => setStartLocationId(e.target.value)}>
                <option value="">Choose a location…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            {customerIdHint && <p className="text-xs text-slate-500">This sale will start for the selected customer.</p>}
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" loading={busy === 'start'} disabled={busy !== null || !startLocationId} className="w-fit">
              Start sale
            </Button>
          </form>
        </CardBody>
      </Card>
    );
  }

  const locationName = locations.find((l) => l.id === cart.locationId)?.name ?? cart.locationId.slice(0, 8);
  const productsDisabled = products.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-slate-900">Customer</p>
              <p className="text-sm text-slate-500">{customerLabel ?? (cart.customerId ? 'Selected' : 'None chosen yet')}</p>
            </div>
            {canSearchCustomers && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => setCustomerPanelOpen((v) => !v)}
              >
                {cart.customerId ? 'Change customer' : 'Choose customer'}
              </Button>
            )}
          </div>

          {missingCustomerData.length > 0 && (
            <Alert tone="warning">
              This customer is missing {missingCustomerData.join(', ')}. Checkout will fail until it is completed
              (open the customer record to fix it).
            </Alert>
          )}

          {customerPanelOpen && canSearchCustomers && (
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              <form onSubmit={searchCustomers} className="flex gap-2">
                <Input
                  type="search"
                  placeholder="Name, tax id, email or phone"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                <Button type="submit" size="sm" loading={busy === 'customer-search'} disabled={busy !== null}>
                  Search
                </Button>
              </form>
              {customerSearched && customerResults.length === 0 && (
                <p className="text-sm text-slate-500">No customers match that search.</p>
              )}
              {customerResults.length > 0 && (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {customerResults.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="text-sm">
                        <span className="font-medium text-slate-900">{c.displayName}</span>
                        {c.taxId && <span className="text-slate-500"> · {c.taxId}</span>}
                        {c.email && <span className="text-slate-500"> · {c.email}</span>}
                      </span>
                      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void chooseCustomer(c)}>
                        Select
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-500">
                Need a new customer? <Link href="/customers/new" className="underline">Add one</Link>, then search again.
              </p>
            </div>
          )}

          <Field label="Location" hint="Changing this re-checks stock availability.">
            <Select
              value={cart.locationId}
              disabled={busy !== null || locations.length === 0}
              onChange={(e) => void changeLocation(e.target.value)}
            >
              {locations.length === 0 && <option value={cart.locationId}>{locationName}</option>}
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Lines</h2>

          {cart.items.length === 0 ? (
            <p className="text-sm text-slate-500">No lines yet — add a product below.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Item</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Unit price</TH>
                  <TH className="text-right">Line subtotal</TH>
                  <TH className="text-right">Available</TH>
                  <TH className="w-0">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {cart.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <span className="font-medium">{item.sku}</span>
                      <span className="text-slate-500"> · {item.productName}</span>
                      {!item.sellable && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          not sellable
                        </span>
                      )}
                      {item.negotiatedUnitPrice !== undefined && (
                        <span className="ml-2 text-xs text-slate-500">negotiated</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <label className="sr-only" htmlFor={`qty-${item.id}`}>
                        Quantity for {item.sku}
                      </label>
                      <input
                        id={`qty-${item.id}`}
                        type="number"
                        min={1}
                        step="any"
                        defaultValue={item.quantity}
                        disabled={busy !== null}
                        onBlur={(e) => {
                          if (Number(e.target.value) !== item.quantity) {
                            void setLineQuantity(item.id, e.target.value);
                          }
                        }}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                      />
                    </TD>
                    <TD className="text-right text-slate-500">{item.unitPrice.toFixed(2)}</TD>
                    <TD className="text-right text-slate-900">{item.lineSubtotal.toFixed(2)}</TD>
                    <TD className={`text-right ${item.availableAtLocation < item.quantity ? 'text-red-600' : 'text-slate-500'}`}>
                      {item.availableAtLocation}
                    </TD>
                    <TD>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void removeLine(item.id)}
                      >
                        Remove
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <form onSubmit={addLine} noValidate className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-4">
            <Field label="Product" required>
              <Select
                value={productId}
                disabled={productsDisabled || busy !== null}
                onChange={(e) => void onProductChange(e.target.value)}
              >
                <option value="">{productsDisabled ? 'No products' : 'Choose…'}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Variant" required {...(variantsLoading ? { hint: 'Loading…' } : {})}>
              <Select
                value={productVariantId}
                disabled={!productId || variantsLoading || busy !== null}
                onChange={(e) => setProductVariantId(e.target.value)}
              >
                <option value="">{productId ? 'Choose…' : 'Pick a product first'}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity" required>
              <Input
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Custom price" hint="Optional — negotiated unit price.">
              <Input
                type="number"
                min={0}
                step="any"
                value={negotiatedPrice}
                onChange={(e) => setNegotiatedPrice(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" size="sm" loading={busy === 'add-line'} disabled={busy !== null || productsDisabled} className="w-fit">
                Add line
              </Button>
            </div>
          </form>

          <p className="ml-auto text-sm">
            Subtotal <span className="font-semibold text-slate-900">{cart.subtotal.toFixed(2)}</span>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Create order</h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-700">Document type</legend>
            {DOCUMENT_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="documentType"
                  value={t}
                  checked={documentType === t}
                  onChange={() => setDocumentType(t)}
                  className="h-4 w-4"
                />
                {DOCUMENT_TYPE_LABELS[t]}
              </label>
            ))}
          </fieldset>

          {!cart.customerId && <p className="text-sm text-amber-700">Choose a customer to continue.</p>}
          {cart.items.length === 0 && <p className="text-sm text-amber-700">Add at least one line to continue.</p>}
          {unsellableLines.length > 0 && (
            <p className="text-sm text-red-700">Remove the lines marked “not sellable” before creating the order.</p>
          )}

          <Button loading={busy === 'checkout'} disabled={!canCheckout} onClick={() => void checkout()} className="w-fit">
            Create order
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
