'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { cn } from '../../../../lib/cn';
import type { LocationScope } from '../../../../lib/inventory/location-scope';
import type { Transfer } from '../../../../lib/types/inventory';
import { Alert } from '../../../../components/ui/alert';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select, Textarea } from '../../../../components/ui/input';
import { TransferProductSearch, type VariantHit } from './transfer-product-search';

const TRANSFERS_PATH = '/api/v1/inventory/transfers';

/** Phone: the same card as the other phone screens; from md up the original, borderless layout. */
const CARD =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:border-0 md:bg-transparent md:p-0 md:shadow-none';
const SECTION = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500';
const TITLE = 'flex items-center gap-2 text-base font-bold text-slate-900';
/** A tinted block inside a phone card (origen / destino / one product). */
const BLOCK = 'flex flex-col gap-3 rounded-xl bg-slate-50 p-3';

export interface WarehouseOption {
  id: string;
  name: string;
}
export interface LocationOption {
  id: string;
  warehouseId: string;
  name: string;
}
interface Line {
  key: number;
  /** What the search box shows once a product is picked ("Name"). */
  productLabel: string;
  /** The picked variant's code. */
  sku: string;
  productVariantId: string;
  quantity: string;
  /** `undefined` = not yet looked up, `null` = looked up but no balance row (zero stock). */
  stockAvailable: number | null | undefined;
  stockLoading: boolean;
}

function emptyLine(key: number): Line {
  return {
    key,
    productLabel: '',
    sku: '',
    productVariantId: '',
    quantity: '',
    stockAvailable: undefined,
    stockLoading: false,
  };
}

async function fetchStockAvailable(productVariantId: string, locationId: string): Promise<number> {
  const result = await apiFetch<{ data: { quantityAvailable: number }[] }>(
    '/api/v1/inventory/balances',
    {
      query: { productVariantId, locationId, pageSize: 1 },
    },
  );
  return result.data[0]?.quantityAvailable ?? 0;
}

/**
 * Creates a transfer — `POST /api/v1/inventory/transfers` (`inventory.transfers.request`). Body is
 * exactly `CreateTransferDto` (`sourceLocationId`, `destinationLocationId`, `items[]`, `notes?`);
 * never `tenantId`/`requestedBy`/`status`. Each line is one variant found with the product search box
 * (`GET /inventory/products-in-stock/variants`, by name or code) plus a quantity. Client
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
  const [sourceWarehouseId, setSourceWarehouseId] = useState(() =>
    sourceWarehouses.length === 1 ? sourceWarehouses[0]!.id : '',
  );
  const [sourceLocationId, setSourceLocationId] = useState(() => {
    if (sourceWarehouses.length !== 1) {
      return '';
    }
    const options = locations.filter(
      (l) =>
        l.warehouseId === sourceWarehouses[0]!.id &&
        (scope.unrestricted || scope.locationIds.includes(l.id)),
    );
    return options.length === 1 ? options[0]!.id : '';
  });
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  // Phone only: once a side (sucursal + almacén) is chosen its fields fold away to avoid confusion;
  // tapping that side of the route summary opens them again. Clearing the almacén re-opens it.
  const [originOpen, setOriginOpen] = useState(() => sourceLocationId === '');
  const [destinationOpen, setDestinationOpen] = useState(true);
  useEffect(() => {
    setOriginOpen(sourceLocationId === '');
  }, [sourceLocationId]);
  useEffect(() => {
    setDestinationOpen(destinationLocationId === '');
  }, [destinationLocationId]);
  const [notes, setNotes] = useState('');
  // Like the receive modal: the notes box stays collapsed until the user asks for it.
  const [notesOpen, setNotesOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([emptyLine(0)]);
  const [nextKey, setNextKey] = useState(1);

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const sourceLocationsInWarehouse = useMemo(() => {
    const inWarehouse = locations.filter((l) => l.warehouseId === sourceWarehouseId);
    return scope.unrestricted
      ? inWarehouse
      : inWarehouse.filter((l) => scope.locationIds.includes(l.id));
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

  async function loadStockFor(
    key: number,
    productVariantId: string,
    locationId: string,
  ): Promise<void> {
    updateLine(key, { stockLoading: true });
    try {
      const available = await fetchStockAvailable(productVariantId, locationId);
      updateLine(key, { stockAvailable: available, stockLoading: false });
    } catch {
      updateLine(key, { stockAvailable: undefined, stockLoading: false });
    }
  }

  /** A search hit is one variant with stock at the origin: the line takes it (and its stock) whole. */
  function onPickVariant(key: number, hit: VariantHit): void {
    updateLine(key, {
      productLabel: hit.productName,
      sku: hit.sku,
      productVariantId: hit.variantId,
      stockAvailable: hit.quantityAvailable,
      stockLoading: false,
      quantity: '',
    });
    setFieldError({});
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
        next[`line-${i}-variant`] = 'Elige un producto.';
      } else if (seen.has(line.productVariantId)) {
        next[`line-${i}-variant`] = 'Esta variante ya está en otra fila.';
      } else {
        seen.add(line.productVariantId);
      }
      const q = Number(line.quantity);
      if (line.quantity === '' || Number.isNaN(q) || q <= 0) {
        next[`line-${i}-quantity`] = 'Ingresa una cantidad mayor que cero.';
      } else if (typeof line.stockAvailable === 'number' && q > line.stockAvailable) {
        next[`line-${i}-quantity`] =
          `No puede superar el stock disponible (${line.stockAvailable}).`;
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
  const productsDisabled = !canViewInventory || !sourceLocationId;
  const productPlaceholder = !canViewInventory
    ? 'No puedes ver el inventario'
    : !sourceLocationId
      ? 'Elige primero el almacén de origen'
      : 'Buscar por nombre o código';

  const locationName = (id: string): string | undefined => locations.find((l) => l.id === id)?.name;
  const warehouseName = (id: string): string | undefined => {
    const all = [...warehouses, ...sourceWarehouses];
    return all.find((w) => w.id === id)?.name;
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 md:max-w-3xl md:gap-5">
      {noSourceScope && (
        <Alert tone="warning">
          No tienes ningún almacén asignado como origen. Pide a un administrador que te asigne al
          menos una ubicación para poder crear transferencias.
        </Alert>
      )}

      {/* Phone only: the chosen route at a glance (names already on the form — nothing new). */}
      {(sourceLocationId || destinationLocationId) && (
        <section className={cn(CARD, 'md:hidden')} aria-label="Ruta elegida">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-slate-50 p-3">
            <button
              type="button"
              aria-expanded={originOpen}
              aria-label="Editar origen"
              onClick={() => setOriginOpen((open) => !open)}
              className="min-w-0 text-left"
            >
              <p className={SECTION}>Origen</p>
              <p className="truncate text-sm font-bold text-slate-900">
                {locationName(sourceLocationId) ?? '—'}
              </p>
              <p className="truncate text-xs text-slate-500">
                {warehouseName(sourceWarehouseId) ?? ''}
              </p>
            </button>
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6.5h10v9H3zM13 9.5h4l3 3v3h-7z" />
                <circle cx="7" cy="17.5" r="1.7" />
                <circle cx="16.5" cy="17.5" r="1.7" />
              </svg>
            </span>
            <button
              type="button"
              aria-expanded={destinationOpen}
              aria-label="Editar destino"
              onClick={() => setDestinationOpen((open) => !open)}
              className="min-w-0 text-right"
            >
              <p className={SECTION}>Destino</p>
              <p className="truncate text-sm font-bold text-slate-900">
                {locationName(destinationLocationId) ?? '—'}
              </p>
              <p className="truncate text-xs text-slate-500">
                {warehouseName(destinationWarehouseId) ?? ''}
              </p>
            </button>
          </div>
        </section>
      )}

      {sameLocation && <Alert tone="warning">El origen y el destino deben ser distintos.</Alert>}

      {/* Ruta: two tinted blocks (origen, destino) on phones; the original 2×2 grid from md up. */}
      <section
        className={cn(CARD, 'flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4')}
        aria-label="Ruta"
      >
        <h3 className={cn(TITLE, 'md:hidden')}>
          <span aria-hidden="true" className="text-blue-700">
            ⇄
          </span>
          Ruta logística
        </h3>
        <div className={originOpen ? cn(BLOCK, 'md:contents') : 'hidden md:contents'}>
          <Field
            className="md:order-1"
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
            className="md:order-3"
            label="Almacén de origen"
            required
            {...(fieldError['sourceLocationId'] ? { error: fieldError['sourceLocationId'] } : {})}
          >
            <Select
              value={sourceLocationId}
              disabled={!sourceWarehouseId}
              onChange={(e) => setSourceLocationId(e.target.value)}
            >
              <option value="">
                {sourceWarehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}
              </option>
              {sourceLocationsInWarehouse.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <span
          className={cn(
            'mx-auto h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700 md:hidden',
            originOpen && destinationOpen ? 'flex' : 'hidden',
          )}
          aria-hidden="true"
        >
          ↓
        </span>
        <div className={destinationOpen ? cn(BLOCK, 'md:contents') : 'hidden md:contents'}>
          <Field
            className="md:order-2"
            label="Sucursal de destino"
            required
            {...(fieldError['destinationWarehouseId']
              ? { error: fieldError['destinationWarehouseId'] }
              : {})}
          >
            <Select
              value={destinationWarehouseId}
              onChange={(e) => onDestinationWarehouseChange(e.target.value)}
            >
              <option value="">Elegir una sucursal…</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            className="md:order-4"
            label="Almacén de destino"
            required
            {...(fieldError['destinationLocationId']
              ? { error: fieldError['destinationLocationId'] }
              : {})}
          >
            <Select
              value={destinationLocationId}
              disabled={!destinationWarehouseId}
              onChange={(e) => setDestinationLocationId(e.target.value)}
            >
              <option value="">
                {destinationWarehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}
              </option>
              {destinationLocationsInWarehouse.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <fieldset className={cn(CARD, 'flex flex-col gap-3 md:gap-4 md:rounded-lg md:shadow-none')}>
        <legend className="sr-only">Productos</legend>
        <div className="flex items-center justify-between gap-2 md:hidden">
          <h3 className={TITLE}>Productos a transferir</h3>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {lines.length} {lines.length === 1 ? 'producto' : 'productos'}
          </span>
        </div>
        {lines.map((line, i) => {
          // Column titles only need to appear once (row 0) once the rows line up as a real desktop
          // grid/table — repeating "Producto"/"Variante"/… on every row is redundant there. Mobile
          // (stacked, below `md`) keeps every row's own labels, since there is no shared header row
          // to lean on in that layout.
          const repeatedLabel = i > 0 ? 'sm:sr-only' : undefined;
          return (
            <div
              key={line.key}
              className={cn(
                BLOCK,
                'md:rounded-none md:bg-transparent md:p-0 md:border-t md:border-slate-100 md:pt-3 md:first:border-t-0 md:first:pt-0',
              )}
            >
              <div className="grid items-start gap-3 md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto_auto]">
                <div className="flex items-center justify-between gap-2 md:contents">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 md:hidden"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-500 md:hidden">
                    {line.sku ? `SKU: ${line.sku}` : ''}
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    aria-label="Quitar fila"
                    title="Quitar fila"
                    className="h-9 w-9 shrink-0 text-lg font-semibold md:order-last md:mt-6 md:h-10 md:w-10"
                    onClick={() => removeLine(line.key)}
                  >
                    ×
                  </Button>
                </div>

                <Field
                  label="Producto"
                  required
                  {...(repeatedLabel ? { labelClassName: repeatedLabel } : {})}
                  {...(fieldError[`line-${i}-variant`]
                    ? { error: fieldError[`line-${i}-variant`] }
                    : {})}
                >
                  <TransferProductSearch
                    locationId={sourceLocationId}
                    selectedLabel={line.productLabel}
                    placeholder={productPlaceholder}
                    disabled={productsDisabled}
                    onPick={(hit) => onPickVariant(line.key, hit)}
                  />
                </Field>

                <div className="flex flex-col gap-1">
                  <span className={cn('text-sm font-medium text-slate-700', repeatedLabel)}>
                    Código
                  </span>
                  <p className="flex h-10 items-center text-sm text-slate-600">{line.sku || '—'}</p>
                </div>

                {/* Stock + Cantidad share one row on phones (stock pill left, stepper right). */}
                <div className="flex items-end justify-between gap-3 md:contents">
                  <div className="flex flex-col gap-1">
                    <span className={cn('text-sm font-medium text-slate-700', repeatedLabel)}>
                      Stock disponible
                    </span>
                    <p className="flex h-10 items-center text-sm text-slate-600">
                      {!line.productVariantId || !sourceLocationId ? (
                        '—'
                      ) : line.stockLoading ? (
                        'Consultando…'
                      ) : typeof line.stockAvailable === 'number' ? (
                        <span className="inline-flex items-baseline gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 font-mono text-emerald-700 md:bg-transparent md:p-0 md:font-sans md:text-slate-600">
                          <span className="text-base font-bold md:text-sm md:font-normal">
                            {line.stockAvailable}
                          </span>
                          <span className="text-xs md:hidden">un.</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </p>
                  </div>

                  <Field
                    label="Cantidad"
                    required
                    {...(repeatedLabel ? { labelClassName: repeatedLabel } : {})}
                    {...(fieldError[`line-${i}-quantity`]
                      ? { error: fieldError[`line-${i}-quantity`] }
                      : {})}
                  >
                    <QuantityControl
                      value={line.quantity}
                      max={
                        typeof line.stockAvailable === 'number' ? line.stockAvailable : undefined
                      }
                      onChange={(quantity) => updateLine(line.key, { quantity })}
                    />
                  </Field>
                </div>

                <Button
                  type="button"
                  variant="primary"
                  aria-label="Agregar fila"
                  title="Agregar fila"
                  disabled={productsDisabled}
                  className="hidden h-10 w-10 shrink-0 text-lg font-semibold md:mt-6 md:flex"
                  onClick={addLine}
                >
                  +
                </Button>
              </div>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          disabled={productsDisabled}
          className="w-full gap-2 md:hidden"
          onClick={addLine}
        >
          <span aria-hidden="true" className="text-lg leading-none text-blue-700">
            ⊕
          </span>
          Añadir producto
        </Button>
      </fieldset>

      <section className={notesOpen || notes ? CARD : undefined} aria-label="Notas">
        {notesOpen || notes ? (
          <Field label="Notas" help="Opcional — visible en la transferencia.">
            <Textarea
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        ) : (
          <button
            type="button"
            className="text-sm font-medium text-blue-700 hover:underline"
            onClick={() => setNotesOpen(true)}
          >
            + Agregar notas
          </button>
        )}
      </section>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-col gap-1 md:flex-row md:gap-2">
        <Button
          type="submit"
          loading={submitting}
          disabled={!canSubmit}
          className="h-11 w-full md:h-10 md:w-fit"
        >
          Crear transferencia
        </Button>
        <ButtonLink href="/inventory/transfers" variant="ghost" className="w-full md:w-fit">
          Cancelar
        </ButtonLink>
      </div>
    </form>
  );
}

/**
 * The "Cantidad" input. From md up it is the plain number input it always was; on phones it gets
 * − / + steppers (capped at the available stock, never below 0) around the same input. `Field`
 * wires its `id`/`aria-*` onto this component, which forwards them to the input.
 */
function QuantityControl({
  value,
  max,
  onChange,
  ...fieldProps
}: {
  value: string;
  max: number | undefined;
  onChange: (next: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'max'>): React.JSX.Element {
  const current = Number(value) || 0;
  const step = (delta: number): void => {
    const next = Math.max(0, max !== undefined ? Math.min(max, current + delta) : current + delta);
    onChange(String(next));
  };
  const stepper =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg font-semibold text-slate-700 md:hidden';
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" aria-label="Restar uno" className={stepper} onClick={() => step(-1)}>
        −
      </button>
      <Input
        {...fieldProps}
        type="number"
        min={0}
        {...(max !== undefined ? { max } : {})}
        step="any"
        value={value}
        className="text-center md:text-left"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label="Sumar uno"
        className={cn(stepper, 'bg-slate-900 text-white')}
        onClick={() => step(1)}
      >
        +
      </button>
    </div>
  );
}
