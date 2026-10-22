'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { LocationScope } from '../../../../lib/inventory/location-scope';
import { type Cart, type Customer, type DocumentType, type Order } from '../../../../lib/types/sales';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Select } from '../../../../components/ui/input';
import { ProductCartModal } from './product-cart-modal';

interface WarehouseOption {
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

/** A distinct idempotency key per logical checkout attempt — reused across retries of that same
 * attempt, regenerated for a fresh one (mirrors `randomCorrelationId` in the api client). */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * The vendor cart → order flow, POS-style (owner redesign). The cart is the backend's own
 * singular `/cart` resource (not browser storage): every edit is an `apiFetch` that returns the
 * full updated cart — this component only ever holds *visual* state (which modal is open), never
 * a parallel copy of the cart's line data. Checkout is still `POST /orders { cartId, documentType }`
 * with a required `Idempotency-Key` header — one key per logical attempt, held across retries.
 *
 * Steps: Sucursal/Almacén (location-scoped, auto-selects a single option) → "Nueva venta" opens
 * one window covering cliente, tipo de comprobante and productos → "Crear pedido" inside that same
 * window creates the order and goes straight to `/sales/:id` (owner redesign — no separate
 * "pedido creado" screen here). The payment method, Finalizar/Cancelar, and requesting a price
 * approval for an exceptional line all happen on that page (`OrderActions`), not here.
 */
export function NewSale({
  initialCart,
  initialCustomer,
  customerIdHint,
  warehouses,
  locations,
  scope,
  canViewProducts,
  canSearchCustomers,
  canManageCustomers,
}: {
  initialCart: Cart | null;
  initialCustomer: CustomerRef | null;
  customerIdHint?: string;
  warehouses: WarehouseOption[];
  locations: LocationOption[];
  scope: LocationScope;
  canViewProducts: boolean;
  canSearchCustomers: boolean;
  canManageCustomers: boolean;
}): React.JSX.Element {
  const router = useRouter();

  const [cart, setCart] = useState<Cart | null>(initialCart);
  const [customerLabel, setCustomerLabel] = useState<string | null>(initialCustomer?.displayName ?? null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [documentType, setDocumentType] = useState<DocumentType>('sales_note');
  const [checkoutKey, setCheckoutKey] = useState('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Paso A — Sucursal/Almacén, scoped to the caller's own ADR-0024 operating scope
  // (`location-scope`). A single valid location auto-selects, several leave the picker open; the
  // backend re-asserts access at `POST /cart` either way (`CartsService.assertLocationSellable`).
  const [warehouseId, setWarehouseId] = useState(() => (warehouses.length === 1 ? warehouses[0]!.id : ''));
  const [locationId, setLocationId] = useState(() => {
    if (warehouses.length !== 1) {
      return '';
    }
    const options = locations.filter(
      (l) => l.warehouseId === warehouses[0]!.id && (scope.unrestricted || scope.locationIds.includes(l.id)),
    );
    return options.length === 1 ? options[0]!.id : '';
  });
  const locationsInWarehouse = useMemo(() => {
    const inWarehouse = locations.filter((l) => l.warehouseId === warehouseId);
    return scope.unrestricted ? inWarehouse : inWarehouse.filter((l) => scope.locationIds.includes(l.id));
  }, [locations, warehouseId, scope]);

  function onWarehouseChange(nextWarehouseId: string): void {
    setWarehouseId(nextWarehouseId);
    setLocationId('');
  }

  const noScope = warehouses.length === 0;

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

  // --- start: "Crear venta" --------------------------------------------------------------------

  async function createSale(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!locationId) {
      setError('Elige el almacén desde donde se hace la venta.');
      return;
    }
    await run('start', async () => {
      const body: Record<string, unknown> = { locationId };
      if (customerIdHint) {
        body['customerId'] = customerIdHint;
      }
      const created = await apiFetch<Cart>('/api/v1/cart', { method: 'POST', body });
      setCart(created);
      setError(null);
      setProductModalOpen(true);
    });
  }

  // --- Eliminar (discard the whole cart) -----------------------------------------------------
  // Separate from removing one line — this discards the entire open cart (`DELETE /cart`,
  // `CartsService.discard`, status -> 'abandoned') so the vendor can start over with a different
  // sucursal/almacén. Also resets every bit of *client-only* wizard state (document type, selected
  // customer) — none of that lives on the cart, so it would otherwise survive into the next one.
  async function discardCart(): Promise<void> {
    await run('discard', async () => {
      await apiFetch('/api/v1/cart', { method: 'DELETE' });
      setCart(null);
      setDocumentType('sales_note');
      setCheckoutKey('');
      setCustomerLabel(null);
      setSelectedCustomer(null);
      setConfirmingDiscard(false);
    });
  }

  async function chooseCustomer(customer: Customer): Promise<void> {
    if (!cart) {
      return;
    }
    const updated = await apiFetch<Cart>('/api/v1/cart', { method: 'PATCH', body: { customerId: customer.id } });
    setCart(updated);
    setSelectedCustomer(customer);
    setCustomerLabel(customer.displayName);
  }

  // --- checkout --------------------------------------------------------------------------------
  // "Crear pedido" fires from inside the `ProductCartModal` itself (owner redesign — no separate
  // checkout step) — this does the actual `POST /orders` and, on success, goes straight to the
  // order's own detail page (`/sales/:id`), where Finalizar/Cancelar/forma de pago/solicitar
  // aprobación all live (`OrderActions`). Lets the modal's own try/catch surface a failure.

  async function checkout(): Promise<void> {
    if (!cart) {
      return;
    }
    const key = checkoutKey || newIdempotencyKey();
    if (!checkoutKey) {
      setCheckoutKey(key);
    }
    const created = await apiFetch<Order>('/api/v1/orders', {
      method: 'POST',
      body: { cartId: cart.id, documentType },
      headers: { 'Idempotency-Key': key },
    });
    router.push(`/sales/${created.id}`);
  }

  // --- render ------------------------------------------------------------------------------

  if (!cart) {
    return (
      <Card>
        <CardBody>
          {noScope && (
            <Alert tone="warning" className="mb-4">
              No tienes ningún almacén asignado para vender. Pide a un administrador que te asigne al menos una
              ubicación.
            </Alert>
          )}
          <form onSubmit={createSale} noValidate className="flex max-w-sm flex-col gap-4">
            <Field label="Sucursal" required>
              <Select value={warehouseId} disabled={noScope} onChange={(e) => onWarehouseChange(e.target.value)}>
                <option value="">Elegir una sucursal…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Almacén" required help="Desde dónde se hace la venta — determina la disponibilidad de stock.">
              <Select value={locationId} disabled={!warehouseId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">{warehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}</option>
                {locationsInWarehouse.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            {customerIdHint && <p className="text-xs text-slate-500">Esta venta empezará para el cliente seleccionado.</p>}
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" loading={busy === 'start'} disabled={busy !== null || !locationId} className="w-fit">
              Nueva venta
            </Button>
          </form>
        </CardBody>
      </Card>
    );
  }

  const locationName = locations.find((l) => l.id === cart.locationId)?.name ?? cart.locationId.slice(0, 8);
  const warehouseName = warehouses.find((w) => w.id === locations.find((l) => l.id === cart.locationId)?.warehouseId)?.name;

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">
                {warehouseName ? `${warehouseName} · ` : ''}
                {locationName}
              </p>
              <p className="text-sm text-slate-500">
                {cart.items.length === 0
                  ? 'Sin productos todavía'
                  : `${cart.items.length} producto${cart.items.length === 1 ? '' : 's'} · subtotal ${cart.subtotal.toFixed(2)}`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setProductModalOpen(true)}>
                {cart.items.length === 0 ? 'Agregar productos' : 'Editar'}
              </Button>
              {!confirmingDiscard && (
                <Button type="button" variant="danger" disabled={busy !== null} onClick={() => setConfirmingDiscard(true)}>
                  Eliminar
                </Button>
              )}
            </div>
          </div>
          {confirmingDiscard && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>¿Eliminar esta venta? Se perderán todos los productos y el cliente elegido.</span>
              <Button size="sm" variant="danger" loading={busy === 'discard'} disabled={busy !== null} onClick={() => void discardCart()}>
                Sí, eliminar
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmingDiscard(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <ProductCartModal
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        cart={cart}
        locationLabel={`${warehouseName ? `${warehouseName} · ` : ''}${locationName}`}
        canViewProducts={canViewProducts}
        onCartUpdated={setCart}
        customerLabel={customerLabel}
        selectedCustomer={selectedCustomer}
        canSearchCustomers={canSearchCustomers}
        canManageCustomers={canManageCustomers}
        onSelectCustomer={chooseCustomer}
        documentType={documentType}
        onDocumentTypeChange={setDocumentType}
        onCheckout={checkout}
      />
    </div>
  );
}
