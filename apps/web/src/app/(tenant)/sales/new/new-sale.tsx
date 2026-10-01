'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { Button, ButtonLink } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

interface Ref {
  id: string;
  name: string;
}
interface LocationOption {
  id: string;
  warehouseId: string;
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
  warehouses,
  locations,
  canSearchCustomers,
}: {
  initialCart: Cart | null;
  initialCustomer: CustomerRef | null;
  customerIdHint?: string;
  products: Ref[];
  warehouses: Ref[];
  locations: LocationOption[];
  canSearchCustomers: boolean;
}): React.JSX.Element {
  const router = useRouter();

  const [cart, setCart] = useState<Cart | null>(initialCart);
  const [customerLabel, setCustomerLabel] = useState<string | null>(initialCustomer?.displayName ?? null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [order, setOrder] = useState<Order | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Start a sale" phase — Sucursal → Almacén, purely client-side (both lists are already bounded
  // fetches from the server component).
  const [startWarehouseId, setStartWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [startLocationId, setStartLocationId] = useState(
    () => locations.find((l) => l.warehouseId === (warehouses[0]?.id ?? ''))?.id ?? '',
  );
  const startLocationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === startWarehouseId),
    [locations, startWarehouseId],
  );
  function onStartWarehouseChange(nextWarehouseId: string): void {
    setStartWarehouseId(nextWarehouseId);
    setStartLocationId(locations.find((l) => l.warehouseId === nextWarehouseId)?.id ?? '');
  }

  // Once a cart exists, its Almacén select is also Sucursal-scoped — but the *committed* value is
  // always `cart.locationId` (a `PATCH /cart` result), never local state. `changeWarehouseId` only
  // narrows which locations are offered; picking one still goes straight through `changeLocation`.
  const [changeWarehouseId, setChangeWarehouseId] = useState(
    () => locations.find((l) => l.id === initialCart?.locationId)?.warehouseId ?? '',
  );
  useEffect(() => {
    setChangeWarehouseId(locations.find((l) => l.id === cart?.locationId)?.warehouseId ?? '');
  }, [cart?.locationId, locations]);
  const changeLocationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === changeWarehouseId),
    [locations, changeWarehouseId],
  );

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
      return 'No tienes autorización para operar en este almacén.';
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
      setError('Elige el almacén desde donde se hace la venta.');
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
      setError('Elige una variante y una cantidad mayor que cero.');
      return;
    }
    if (inCartVariantIds.has(productVariantId)) {
      setError('Esa variante ya está en la venta — cambia su cantidad en las líneas de abajo.');
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
            Pedido <span className="font-medium">{order.orderNumber}</span> creado — estado{' '}
            <span className="font-medium">{order.status}</span>. El stock está reservado.
          </Alert>
          {exceptional && (
            <Alert tone="warning">
              Una o más líneas están por debajo del precio mínimo. El pedido necesita una aprobación de precio antes de poder confirmarse.
            </Alert>
          )}
          <dl className="grid max-w-sm grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">Cliente</dt>
            <dd className="text-slate-900">{order.customer.name}</dd>
            <dt className="text-slate-500">Documento</dt>
            <dd className="text-slate-900">{DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType}</dd>
            <dt className="text-slate-500">Total</dt>
            <dd className="text-slate-900">
              {order.total.toFixed(2)} {order.currency}
            </dd>
          </dl>
          <div className="flex gap-2">
            <ButtonLink href={`/sales/${order.id}`}>Ver pedido</ButtonLink>
            <Button variant="ghost" onClick={startAnother}>
              Iniciar otra venta
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
            <Field label="Sucursal" required>
              <Select value={startWarehouseId} onChange={(e) => onStartWarehouseChange(e.target.value)}>
                <option value="">Elegir una sucursal…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Almacén" required hint="Desde dónde se hace la venta — determina la disponibilidad de stock.">
              <Select
                value={startLocationId}
                disabled={!startWarehouseId}
                onChange={(e) => setStartLocationId(e.target.value)}
              >
                <option value="">{startWarehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}</option>
                {startLocationsInWarehouse.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            {customerIdHint && <p className="text-xs text-slate-500">Esta venta empezará para el cliente seleccionado.</p>}
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" loading={busy === 'start'} disabled={busy !== null || !startLocationId} className="w-fit">
              Iniciar venta
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
              <p className="text-sm font-medium text-slate-900">Cliente</p>
              <p className="text-sm text-slate-500">{customerLabel ?? (cart.customerId ? 'Seleccionado' : 'Ninguno elegido aún')}</p>
            </div>
            {canSearchCustomers && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => setCustomerPanelOpen((v) => !v)}
              >
                {cart.customerId ? 'Cambiar cliente' : 'Elegir cliente'}
              </Button>
            )}
          </div>

          {missingCustomerData.length > 0 && (
            <Alert tone="warning">
              A este cliente le falta {missingCustomerData.join(', ')}. El cierre de venta fallará hasta que se
              complete (abre el registro del cliente para corregirlo).
            </Alert>
          )}

          {customerPanelOpen && canSearchCustomers && (
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              <form onSubmit={searchCustomers} className="flex gap-2">
                <Input
                  type="search"
                  placeholder="Nombre, identificación tributaria, correo o teléfono"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                <Button type="submit" size="sm" loading={busy === 'customer-search'} disabled={busy !== null}>
                  Buscar
                </Button>
              </form>
              {customerSearched && customerResults.length === 0 && (
                <p className="text-sm text-slate-500">Ningún cliente coincide con esa búsqueda.</p>
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
                        Seleccionar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-500">
                ¿Necesitas un cliente nuevo? <Link href="/customers/new" className="underline">Agrega uno</Link>, luego busca de nuevo.
              </p>
            </div>
          )}

          <Field label="Sucursal">
            <Select
              value={changeWarehouseId}
              disabled={busy !== null || warehouses.length === 0}
              onChange={(e) => setChangeWarehouseId(e.target.value)}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Almacén" hint="Cambiar esto vuelve a comprobar la disponibilidad de stock.">
            <Select
              value={cart.locationId}
              disabled={busy !== null || changeLocationsInWarehouse.length === 0}
              onChange={(e) => void changeLocation(e.target.value)}
            >
              {changeLocationsInWarehouse.length === 0 && <option value={cart.locationId}>{locationName}</option>}
              {changeLocationsInWarehouse.map((l) => (
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
          <h2 className="text-sm font-semibold text-slate-900">Líneas</h2>

          {cart.items.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no hay líneas — agrega un producto abajo.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Artículo</TH>
                  <TH className="text-right">Cant.</TH>
                  <TH className="text-right">Precio unitario</TH>
                  <TH className="text-right">Subtotal de línea</TH>
                  <TH className="text-right">Disponible</TH>
                  <TH className="w-0">
                    <span className="sr-only">Acciones</span>
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
                          no vendible
                        </span>
                      )}
                      {item.negotiatedUnitPrice !== undefined && (
                        <span className="ml-2 text-xs text-slate-500">negociado</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <label className="sr-only" htmlFor={`qty-${item.id}`}>
                        Cantidad para {item.sku}
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
                        Quitar
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <form onSubmit={addLine} noValidate className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-4">
            <Field label="Producto" required>
              <Select
                value={productId}
                disabled={productsDisabled || busy !== null}
                onChange={(e) => void onProductChange(e.target.value)}
              >
                <option value="">{productsDisabled ? 'Sin productos' : 'Elegir…'}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Variante" required {...(variantsLoading ? { hint: 'Cargando…' } : {})}>
              <Select
                value={productVariantId}
                disabled={!productId || variantsLoading || busy !== null}
                onChange={(e) => setProductVariantId(e.target.value)}
              >
                <option value="">{productId ? 'Elegir…' : 'Elige primero un producto'}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cantidad" required>
              <Input
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Precio personalizado" hint="Opcional — precio unitario negociado.">
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
                Agregar línea
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
          <h2 className="text-sm font-semibold text-slate-900">Crear pedido</h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-700">Tipo de documento</legend>
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

          {!cart.customerId && <p className="text-sm text-amber-700">Elige un cliente para continuar.</p>}
          {cart.items.length === 0 && <p className="text-sm text-amber-700">Agrega al menos una línea para continuar.</p>}
          {unsellableLines.length > 0 && (
            <p className="text-sm text-red-700">Quita las líneas marcadas «no vendible» antes de crear el pedido.</p>
          )}

          <Button loading={busy === 'checkout'} disabled={!canCheckout} onClick={() => void checkout()} className="w-fit">
            Crear pedido
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
