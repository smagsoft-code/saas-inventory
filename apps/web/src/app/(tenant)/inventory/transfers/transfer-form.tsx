'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { cn } from '../../../../lib/cn';
import type { LocationScope } from '../../../../lib/inventory/location-scope';
import type { Transfer } from '../../../../lib/types/inventory';
import { Alert } from '../../../../components/ui/alert';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select, Textarea } from '../../../../components/ui/input';

const TRANSFERS_PATH = '/api/v1/inventory/transfers';

interface ProductOption {
  id: string;
  name: string;
}
export interface WarehouseOption {
  id: string;
  name: string;
}
export interface LocationOption {
  id: string;
  warehouseId: string;
  name: string;
}
interface VariantOption {
  id: string;
  sku: string;
}
interface Line {
  key: number;
  productId: string;
  variants: VariantOption[];
  variantsLoading: boolean;
  productVariantId: string;
  quantity: string;
  /** `undefined` = not yet looked up, `null` = looked up but no balance row (zero stock). */
  stockAvailable: number | null | undefined;
  stockLoading: boolean;
}

function emptyLine(key: number): Line {
  return {
    key,
    productId: '',
    variants: [],
    variantsLoading: false,
    productVariantId: '',
    quantity: '',
    stockAvailable: undefined,
    stockLoading: false,
  };
}

async function fetchStockAvailable(productVariantId: string, locationId: string): Promise<number> {
  const result = await apiFetch<{ data: { quantityAvailable: number }[] }>('/api/v1/inventory/balances', {
    query: { productVariantId, locationId, pageSize: 1 },
  });
  return result.data[0]?.quantityAvailable ?? 0;
}

/** `GET /inventory/products-in-stock?locationId=` (`inventory.view`) — only products with at
 * least one variant carrying available stock at that location, never the tenant's whole catalog
 * (F17-TRANSFERS-AUDIT). */
async function fetchProductsInStock(locationId: string): Promise<ProductOption[]> {
  return apiFetch<ProductOption[]>('/api/v1/inventory/products-in-stock', { query: { locationId } });
}

/**
 * Creates a transfer — `POST /api/v1/inventory/transfers` (`inventory.transfers.request`). Body is
 * exactly `CreateTransferDto` (`sourceLocationId`, `destinationLocationId`, `items[]`, `notes?`);
 * never `tenantId`/`requestedBy`/`status`. Each line is Product → Variant → quantity, reusing
 * `GET /products/:id/variants` (no tenant-wide variant list — `GAP-VARIANT-LIST`). Client
 * validation (including "cantidad <= stock disponible") is a UX mirror only — the backend
 * re-validates and authorizes both (F17-TRANSFERS-AUDIT §4/§17).
 *
 * `sourceWarehouses`/`sourceLocations` are already filtered to the caller's ADR-0024 operating
 * scope (`scope`) by the parent Server Component — never trusted as the *only* enforcement (the
 * backend still asserts access at create()), just what the picker offers. Destination keeps its
 * existing, unrestricted behaviour (§7 — not part of this scoping). When the scoped source list has
 * exactly one warehouse/location, it is pre-selected automatically (§6) — the user is never made to
 * click through a single-option picker.
 *
 * "Producto" is gated behind picking an origin: only once `sourceLocationId` is known can the form
 * ask which products actually have stock there (`GET /inventory/products-in-stock`) — before that
 * it stays disabled, never the tenant's whole catalog.
 */
export function TransferForm({
  warehouses,
  locations,
  sourceWarehouses,
  scope,
  canViewInventory,
}: {
  warehouses: WarehouseOption[];
  locations: LocationOption[];
  sourceWarehouses: WarehouseOption[];
  scope: LocationScope;
  canViewInventory: boolean;
}): React.JSX.Element {
  const router = useRouter();
  // §6: auto-select ONLY the initial, scope-derived default — a single-option scope is pre-filled
  // once, up front. A later manual warehouse change (onSourceWarehouseChange) resets the location
  // to '' and stays reset even if that narrower list also happens to have one entry, so the reset
  // is never immediately fought back by an effect re-applying the "only one option" rule.
  const [sourceWarehouseId, setSourceWarehouseId] = useState(() => (sourceWarehouses.length === 1 ? sourceWarehouses[0]!.id : ''));
  const [sourceLocationId, setSourceLocationId] = useState(() => {
    if (sourceWarehouses.length !== 1) {
      return '';
    }
    const options = locations.filter(
      (l) => l.warehouseId === sourceWarehouses[0]!.id && (scope.unrestricted || scope.locationIds.includes(l.id)),
    );
    return options.length === 1 ? options[0]!.id : '';
  });
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(0)]);
  const [nextKey, setNextKey] = useState(1);

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [originProducts, setOriginProducts] = useState<ProductOption[]>([]);
  const [originProductsLoading, setOriginProductsLoading] = useState(false);

  // Re-fetch the eligible product list every time the source location changes — "Producto" is
  // always relative to the chosen origin, never a static, unfiltered catalog fetch.
  useEffect(() => {
    if (!sourceLocationId) {
      setOriginProducts([]);
      return;
    }
    let cancelled = false;
    setOriginProductsLoading(true);
    void fetchProductsInStock(sourceLocationId)
      .then((rows) => {
        if (!cancelled) {
          setOriginProducts(rows);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOriginProducts([]);
          setError(httpErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOriginProductsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceLocationId]);

  const sourceLocationsInWarehouse = useMemo(() => {
    const inWarehouse = locations.filter((l) => l.warehouseId === sourceWarehouseId);
    return scope.unrestricted ? inWarehouse : inWarehouse.filter((l) => scope.locationIds.includes(l.id));
  }, [locations, sourceWarehouseId, scope]);
  const destinationLocationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === destinationWarehouseId),
    [locations, destinationWarehouseId],
  );

  function onSourceWarehouseChange(nextWarehouseId: string): void {
    setSourceWarehouseId(nextWarehouseId);
    setSourceLocationId('');
  }
  function onDestinationWarehouseChange(nextWarehouseId: string): void {
    setDestinationWarehouseId(nextWarehouseId);
    setDestinationLocationId('');
  }

  const sameLocation = sourceLocationId !== '' && sourceLocationId === destinationLocationId;

  const canSubmit = useMemo(
    () =>
      sourceLocationId !== '' &&
      destinationLocationId !== '' &&
      !sameLocation &&
      lines.length > 0 &&
      lines.every((line) => line.productVariantId !== '' && Number(line.quantity) > 0),
    [sourceLocationId, destinationLocationId, sameLocation, lines],
  );

  function updateLine(key: number, patch: Partial<Line>): void {
    setLines((cur) => cur.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine(): void {
    setLines((cur) => [...cur, emptyLine(nextKey)]);
    setNextKey((k) => k + 1);
  }

  /** §2: a single remaining line is never removed outright — it resets to empty so the form always
   * has at least one editable, "+"-reachable line. Two or more: the targeted row is removed and the
   * rest are left alone. */
  function removeLine(key: number): void {
    setLines((cur) => {
      if (cur.length > 1) {
        return cur.filter((line) => line.key !== key);
      }
      return [emptyLine(key)];
    });
    setFieldError({});
  }

  async function loadStockFor(key: number, productVariantId: string, locationId: string): Promise<void> {
    updateLine(key, { stockLoading: true });
    try {
      const available = await fetchStockAvailable(productVariantId, locationId);
      updateLine(key, { stockAvailable: available, stockLoading: false });
    } catch {
      updateLine(key, { stockAvailable: undefined, stockLoading: false });
    }
  }

  async function onProductChange(key: number, productId: string): Promise<void> {
    updateLine(key, {
      productId,
      productVariantId: '',
      variants: [],
      variantsLoading: Boolean(productId),
      stockAvailable: undefined,
    });
    if (!productId) {
      return;
    }
    try {
      const rows = await apiFetch<{ id: string; sku: string }[]>(`/api/v1/products/${productId}/variants`);
      const variants = rows.map((r) => ({ id: r.id, sku: r.sku }));
      updateLine(key, { variants, variantsLoading: false });
      // §3: a single-variant product never makes the user pick a variant manually.
      if (variants.length === 1 && sourceLocationId) {
        updateLine(key, { productVariantId: variants[0]!.id });
        void loadStockFor(key, variants[0]!.id, sourceLocationId);
      } else if (variants.length === 1) {
        updateLine(key, { productVariantId: variants[0]!.id });
      }
    } catch (err) {
      updateLine(key, { variantsLoading: false });
      setError(httpErrorMessage(err));
    }
  }

  function onVariantChange(key: number, productVariantId: string): void {
    updateLine(key, { productVariantId, stockAvailable: undefined });
    if (productVariantId && sourceLocationId) {
      void loadStockFor(key, productVariantId, sourceLocationId);
    }
  }

  // Origin changed — re-check stock for every line that already has a variant chosen, since
  // "stock disponible" is always relative to the (possibly just-changed) source location.
  useEffect(() => {
    if (!sourceLocationId) {
      return;
    }
    for (const line of lines) {
      if (line.productVariantId) {
        void loadStockFor(line.key, line.productVariantId, sourceLocationId);
      }
    }
    // Only re-run when the source location itself changes — re-fetching on every `lines` change
    // (e.g. typing a quantity) would be wasteful and is handled by onVariantChange instead.
    // (No `react-hooks/exhaustive-deps` in this project's lint config to suppress — deliberate.)
  }, [sourceLocationId]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!sourceWarehouseId) next['sourceWarehouseId'] = 'Elige una sucursal de origen.';
    if (!destinationWarehouseId) next['destinationWarehouseId'] = 'Elige una sucursal de destino.';
    if (!sourceLocationId) next['sourceLocationId'] = 'Elige un almacén de origen.';
    if (!destinationLocationId) next['destinationLocationId'] = 'Elige un almacén de destino.';
    if (sameLocation) next['destinationLocationId'] = 'El origen y el destino deben ser distintos.';

    const seen = new Set<string>();
    lines.forEach((line, i) => {
      if (!line.productVariantId) {
        next[`line-${i}-variant`] = 'Elige una variante.';
      } else if (seen.has(line.productVariantId)) {
        next[`line-${i}-variant`] = 'Esta variante ya está en otra línea.';
      } else {
        seen.add(line.productVariantId);
      }
      const q = Number(line.quantity);
      if (line.quantity === '' || Number.isNaN(q) || q <= 0) {
        next[`line-${i}-quantity`] = 'Ingresa una cantidad mayor que cero.';
      } else if (typeof line.stockAvailable === 'number' && q > line.stockAvailable) {
        next[`line-${i}-quantity`] = `No puede superar el stock disponible (${line.stockAvailable}).`;
      }
    });

    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !canSubmit) {
      return;
    }
    if (!validate()) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        sourceLocationId,
        destinationLocationId,
        items: lines.map((line) => ({
          productVariantId: line.productVariantId,
          quantityRequested: Number(line.quantity),
        })),
      };
      if (notes.trim()) {
        body['notes'] = notes.trim();
      }
      const created = await apiFetch<Transfer>(TRANSFERS_PATH, { method: 'POST', body });
      router.push(`/inventory/transfers/${created.id}?created=1`);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('No tienes autorización para crear una transferencia para estos almacenes.');
      } else if (isApiError(err) && err.status === 409) {
        setError(httpErrorMessage(err));
      } else {
        setError(httpErrorMessage(err));
      }
      setSubmitting(false);
    }
  }

  const noSourceScope = sourceWarehouses.length === 0;
  const productsDisabled = !canViewInventory || !sourceLocationId || originProductsLoading || originProducts.length === 0;
  const productPlaceholder = !canViewInventory
    ? 'No puedes ver el inventario'
    : !sourceLocationId
      ? 'Elige primero el almacén de origen'
      : originProductsLoading
        ? 'Cargando productos…'
        : originProducts.length === 0
          ? 'Sin productos con stock en este almacén'
          : 'Elegir un producto…';

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-3xl flex-col gap-5">
      {noSourceScope && (
        <Alert tone="warning">
          No tienes ningún almacén asignado como origen. Pide a un administrador que te asigne al
          menos una ubicación para poder crear transferencias.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Sucursal de origen"
          required
          {...(fieldError['sourceWarehouseId'] ? { error: fieldError['sourceWarehouseId'] } : {})}
        >
          <Select
            value={sourceWarehouseId}
            disabled={noSourceScope}
            onChange={(e) => onSourceWarehouseChange(e.target.value)}
          >
            <option value="">Elegir una sucursal…</option>
            {sourceWarehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Sucursal de destino"
          required
          {...(fieldError['destinationWarehouseId'] ? { error: fieldError['destinationWarehouseId'] } : {})}
        >
          <Select value={destinationWarehouseId} onChange={(e) => onDestinationWarehouseChange(e.target.value)}>
            <option value="">Elegir una sucursal…</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Almacén de origen"
          required
          {...(fieldError['sourceLocationId'] ? { error: fieldError['sourceLocationId'] } : {})}
        >
          <Select
            value={sourceLocationId}
            disabled={!sourceWarehouseId}
            onChange={(e) => setSourceLocationId(e.target.value)}
          >
            <option value="">{sourceWarehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}</option>
            {sourceLocationsInWarehouse.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Almacén de destino"
          required
          {...(fieldError['destinationLocationId'] ? { error: fieldError['destinationLocationId'] } : {})}
        >
          <Select
            value={destinationLocationId}
            disabled={!destinationWarehouseId}
            onChange={(e) => setDestinationLocationId(e.target.value)}
          >
            <option value="">{destinationWarehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}</option>
            {destinationLocationsInWarehouse.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4">
        {lines.map((line, i) => {
          const singleVariant = line.variants.length === 1;
          // Column titles only need to appear once (row 0) once the rows line up as a real desktop
          // grid/table — repeating "Producto"/"Variante"/… on every row is redundant there. Mobile
          // (stacked, below `sm`) keeps every row's own labels, since there is no shared header row
          // to lean on in that layout.
          const repeatedLabel = i > 0 ? 'sm:sr-only' : undefined;
          return (
            <div key={line.key} className="flex flex-col gap-3 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
              <div className="grid items-start gap-3 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto_auto]">
                <Field label="Producto" required {...(repeatedLabel ? { labelClassName: repeatedLabel } : {})}>
                  <Select
                    value={line.productId}
                    disabled={productsDisabled}
                    onChange={(e) => void onProductChange(line.key, e.target.value)}
                  >
                    <option value="">{productPlaceholder}</option>
                    {originProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                {singleVariant ? (
                  <div className="flex flex-col gap-1">
                    <span className={cn('text-sm font-medium text-slate-700', repeatedLabel)}>Variante</span>
                    <p className="flex h-10 items-center text-sm text-slate-600">{line.variants[0]!.sku}</p>
                  </div>
                ) : (
                  <Field
                    label="Variante"
                    required
                    {...(repeatedLabel ? { labelClassName: repeatedLabel } : {})}
                    {...(fieldError[`line-${i}-variant`] ? { error: fieldError[`line-${i}-variant`] } : {})}
                    {...(line.variantsLoading ? { hint: 'Cargando variantes…' } : {})}
                  >
                    <Select
                      value={line.productVariantId}
                      disabled={!line.productId || line.variantsLoading}
                      onChange={(e) => onVariantChange(line.key, e.target.value)}
                    >
                      <option value="">{line.productId ? 'Elegir una variante…' : 'Elige primero un producto'}</option>
                      {line.variants.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.sku}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                <div className="flex flex-col gap-1">
                  <span className={cn('text-sm font-medium text-slate-700', repeatedLabel)}>Stock disponible</span>
                  <p className="flex h-10 items-center text-sm text-slate-600">
                    {!line.productVariantId || !sourceLocationId
                      ? '—'
                      : line.stockLoading
                        ? 'Consultando…'
                        : typeof line.stockAvailable === 'number'
                          ? line.stockAvailable
                          : '—'}
                  </p>
                </div>

                <Field
                  label="Cantidad"
                  required
                  {...(repeatedLabel ? { labelClassName: repeatedLabel } : {})}
                  {...(fieldError[`line-${i}-quantity`] ? { error: fieldError[`line-${i}-quantity`] } : {})}
                >
                  <Input
                    type="number"
                    min={0}
                    {...(typeof line.stockAvailable === 'number' ? { max: line.stockAvailable } : {})}
                    step="any"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  />
                </Field>

                <Button
                  type="button"
                  variant="primary"
                  aria-label="Agregar línea"
                  title="Agregar línea"
                  disabled={productsDisabled}
                  className="mt-6 h-10 w-10 shrink-0 text-lg font-semibold"
                  onClick={addLine}
                >
                  +
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  aria-label="Quitar línea"
                  title="Quitar línea"
                  className="mt-6 h-10 w-10 shrink-0 text-lg font-semibold"
                  onClick={() => removeLine(line.key)}
                >
                  ×
                </Button>
              </div>
            </div>
          );
        })}
      </fieldset>

      <Field label="Notas" hint="Opcional — visible en la transferencia.">
        <Textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {sameLocation && <Alert tone="warning">El origen y el destino deben ser distintos.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!canSubmit} className="w-fit">
          Crear transferencia
        </Button>
        <ButtonLink href="/inventory/transfers" variant="ghost" className="w-fit">
          Cancelar
        </ButtonLink>
      </div>
    </form>
  );
}
