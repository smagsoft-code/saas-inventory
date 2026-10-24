'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { buildKardexExportHref, getKardex } from '../../../lib/inventory/kardex';
import type { KardexResponse } from '../../../lib/types/kardex';
import { Button, Card, CardBody, EmptyState, ErrorState, Field, Input, Select, Spinner } from '../../../components/ui';
import { ExportLinks } from '../../../components/export-icons';
import { KardexAllLocations } from './kardex-all-locations';
import { KardexAllMovements } from './kardex-all-movements';
import { KardexStockByLocation } from './kardex-stock-by-location';
import { KardexTable } from './kardex-table';

interface ProductOption {
  id: string;
  name: string;
}
/** One search hit = one variant (its code + its product's name), from the variant-grain catalog. */
interface PickerHit {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
}
interface VariantOption {
  id: string;
  sku: string;
}
export interface LocationOption {
  id: string;
  name: string;
  warehouseId: string;
  warehouseName: string;
}

/** Sentinel value of the Almacén select: totals across every location holding the variant. */
const ALL_LOCATIONS = '__all__';

// Stock / Costo promedio / Valor tiles — same tile style as Inicio and Productos, always one row.
const STAT_BOX = 'min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3';
const STAT_LABEL = 'truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500';
const STAT_VALUE = 'mt-1 truncate font-mono text-lg font-bold tabular-nums text-slate-900 md:text-xl';

const SEARCH_DEBOUNCE_MS = 250;
const PICKER_PAGE_SIZE = 10;

function nextDayStartUtc(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function money(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(2);
}

/**
 * `/inventory`'s Kardex explorer (UI-UX-SPEC-001) — owns the entire search → filter → select →
 * ledger flow client-side, on demand. Nothing here fetches on mount: no product list, no variant
 * list, no movement, until the user focuses the search field (§1/§22 — the screen must never
 * auto-load the tenant's full catalog or its full movement history).
 *
 * "Ver todos" is not a separate button — focusing the search box with an empty query opens the
 * same picker panel already paginating the full product list; typing narrows it via the real
 * `q` search. Selecting a variant is a direct click, no confirming "Seleccionar" button. The ledger
 * (Costo K / Stock / V.Total) is only well-defined for one variant+location at a time (a transfer
 * can leave two locations with different average costs for the same variant), so this never
 * becomes a merged multi-product table.
 *
 * `locations` (this tenant's small reference list, bounded, already fetched once by the server
 * page) is the one exception to "nothing loads eagerly" — the same list every other inventory form
 * (add-stock, adjust) already fetches up front, not the product/movement volume §22 is about.
 */
export function KardexExplorer({ locations }: { locations: LocationOption[] }): React.JSX.Element {
  // --- product picker ("Ver todos" is just this panel with an empty query) ----------------------
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPage, setPickerPage] = useState(1);
  const [pickerResults, setPickerResults] = useState<{ data: PickerHit[]; meta: { total: number; totalPages: number } } | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // --- "Ver todos" trial: a flat, tenant-wide movement feed instead of one product's Kardex ------
  const [allMovementsMode, setAllMovementsMode] = useState(false);

  // --- selection ---------------------------------------------------------------------------------
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [variantLocations, setVariantLocations] = useState<LocationOption[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState('');

  // --- date filters + sort ---------------------------------------------------------------------
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortDescending, setSortDescending] = useState(false);
  const dateError = dateFrom && dateTo && dateFrom > dateTo ? 'La fecha inicio debe ser anterior o igual a la fecha fin.' : null;

  // --- kardex --------------------------------------------------------------------------------
  const [kardexData, setKardexData] = useState<KardexResponse | null>(null);
  const [kardexLoading, setKardexLoading] = useState(false);
  const [kardexError, setKardexError] = useState<unknown>(null);

  const locationsById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  function fetchPickerPage(page: number): void {
    setPickerLoading(true);
    apiFetch<{ data: PickerHit[]; meta: { total: number; totalPages: number } }>('/api/v1/reports/product-catalog', {
      query: { page, pageSize: PICKER_PAGE_SIZE, ...(query.trim() ? { q: query.trim() } : {}) },
    })
      .then((res) => {
        setPickerResults(res);
        setPickerPage(page);
      })
      .catch(() => setPickerResults({ data: [], meta: { total: 0, totalPages: 1 } }))
      .finally(() => setPickerLoading(false));
  }

  function openPicker(): void {
    setPickerOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchPickerPage(1);
  }

  // Re-search (debounced) whenever the query changes while the picker is open — this is what makes
  // an empty query behave as "Ver todos" and typing behave as live search, in the same panel,
  // without a separate button for either.
  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPickerPage(1), SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, pickerOpen]);

  // Close on outside click.
  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    function onDocumentMouseDown(event: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [pickerOpen]);

  function resetSelection(): void {
    setSelectedProduct(null);
    setVariants([]);
    setSelectedVariantId('');
    setVariantLocations([]);
    setSelectedLocationId('');
    setKardexData(null);
    setKardexError(null);
  }

  /** `preferredLocationId`: when the caller already knows exactly which location it wants (e.g. a
   * row clicked in "Ver todos" carries its own location), that wins over the usual
   * only-one-option auto-select. */
  function selectVariant(variantId: string, preferredLocationId?: string): void {
    setSelectedVariantId(variantId);
    setVariantLocations([]);
    setSelectedLocationId('');
    setKardexData(null);
    setKardexError(null);
    setLocationsLoading(true);
    apiFetch<{ data: { locationId: string }[] }>('/api/v1/inventory/balances', { query: { productVariantId: variantId, pageSize: 100 } })
      .then((res) => {
        const withStock = res.data.map((row) => locationsById.get(row.locationId) ?? { id: row.locationId, name: row.locationId, warehouseId: '', warehouseName: '' });
        // No balance row yet for this variant anywhere — fall back to every tenant location so the
        // user can still open an (empty) Kardex, rather than a dead end.
        const options = withStock.length > 0 ? withStock : locations;
        setVariantLocations(options);
        if (preferredLocationId) {
          setSelectedLocationId(preferredLocationId);
        } else if (options.length === 1 && options[0]) {
          setSelectedLocationId(options[0].id);
        }
      })
      .catch(() => setVariantLocations(locations))
      .finally(() => setLocationsLoading(false));
  }

  /** A search hit already names its variant: select that product AND that variant in one go (even when
   * the product has several), instead of making the user pick it again. */
  function selectHit(hit: PickerHit): void {
    resetSelection();
    setAllMovementsMode(false);
    setSelectedProduct({ id: hit.productId, name: hit.productName });
    setPickerOpen(false);
    setQuery('');
    setVariantsLoading(true);
    apiFetch<VariantOption[]>(`/api/v1/products/${hit.productId}/variants`)
      .then((rows) => {
        setVariants(rows);
        selectVariant(hit.variantId);
      })
      .catch(() => setVariants([]))
      .finally(() => setVariantsLoading(false));
  }

  /** A row clicked in "Ver todos" already carries its own product/variant/location — this jumps
   * straight to the same end state `selectProduct` + picking a variant + picking an almacén would
   * reach, except the almacén is this row's own rather than auto-selected or prompted. */
  function selectRowFromAllMovements(selection: { productId: string; productName: string; productVariantId: string; locationId: string }): void {
    resetSelection();
    setAllMovementsMode(false);
    setSelectedProduct({ id: selection.productId, name: selection.productName });
    setPickerOpen(false);
    setQuery('');
    setVariantsLoading(true);
    apiFetch<VariantOption[]>(`/api/v1/products/${selection.productId}/variants`)
      .then((rows) => {
        setVariants(rows);
        selectVariant(selection.productVariantId, selection.locationId);
      })
      .catch(() => setVariants([]))
      .finally(() => setVariantsLoading(false));
  }

  function fetchKardex(): void {
    if (!selectedVariantId || !selectedLocationId || dateError) {
      return;
    }
    if (selectedLocationId === ALL_LOCATIONS) {
      // The ledger is per location; the all-locations view loads its own per-location totals.
      setKardexData(null);
      setKardexError(null);
      return;
    }
    setKardexLoading(true);
    setKardexError(null);
    const from = dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined;
    const to = dateTo ? nextDayStartUtc(dateTo) : undefined;
    getKardex({ productVariantId: selectedVariantId, locationId: selectedLocationId, ...(from ? { from } : {}), ...(to ? { to } : {}) })
      .then(setKardexData)
      .catch(setKardexError)
      .finally(() => setKardexLoading(false));
  }

  useEffect(() => {
    fetchKardex();
  }, [selectedVariantId, selectedLocationId, dateFrom, dateTo]);

  const selectedLocation = variantLocations.find((l) => l.id === selectedLocationId) ?? locationsById.get(selectedLocationId);
  const showCost = kardexData ? kardexData.opening.averageCost !== undefined : false;
  const allLocationsSelected = selectedLocationId === ALL_LOCATIONS;
  // The code of the variant being viewed — known as soon as one is chosen (a product with several
  // variants shows none until the user picks one).
  const selectedVariantSku = variants.find((variant) => variant.id === selectedVariantId)?.sku;

  const exportQuery = selectedVariantId && selectedLocationId && !allLocationsSelected
    ? {
        productVariantId: selectedVariantId,
        locationId: selectedLocationId,
        ...(dateFrom ? { from: `${dateFrom}T00:00:00.000Z` } : {}),
        ...(dateTo ? { to: nextDayStartUtc(dateTo) } : {}),
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* --- filtros superiores: búsqueda + fechas + orden, una sola fila --- */}
      <div className="flex flex-wrap items-end gap-3">
        <div ref={pickerRef} className="relative min-w-[16rem] flex-1">
          <Field label="Buscar producto">
            <Input
              value={query}
              onFocus={openPicker}
              placeholder="Ej: Silla de comedor, SKU-1234…"
              onChange={(event) => {
                setQuery(event.target.value);
                if (!pickerOpen) setPickerOpen(true);
              }}
            />
          </Field>
          {pickerOpen && (
            <Card className="absolute z-10 mt-1 max-h-80 w-full overflow-auto shadow-lg">
              {/* A plain div, not CardBody: CardBody carries p-4 sm:p-6 and this project has no tailwind-merge, so a `p-*` override
                  never wins — that padding was most of the dropdown's height. */}
              <div className="flex flex-col p-1">
                {pickerLoading && (
                  <div className="flex items-center gap-2 px-2 py-1 text-sm text-slate-500">
                    <Spinner className="h-4 w-4" /> Cargando…
                  </div>
                )}
                {!pickerLoading && pickerResults && pickerResults.data.length === 0 && (
                  <p className="px-2 py-1 text-sm text-slate-500">
                    {query.trim() ? `Ningún producto coincide con "${query}".` : 'No hay productos registrados.'}
                  </p>
                )}
                {!pickerLoading &&
                  pickerResults?.data.map((hit) => (
                    <button
                      key={hit.variantId}
                      type="button"
                      onClick={() => selectHit(hit)}
                      className="flex items-center gap-1.5 rounded px-2 py-0.5 text-left text-sm leading-5 text-slate-800 hover:bg-slate-50"
                    >
                      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-slate-500">{hit.sku}</span>
                      <span className="min-w-0 truncate">{hit.productName}</span>
                    </button>
                  ))}
                {!pickerLoading && pickerResults && pickerResults.meta.totalPages > 1 && (
                  <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1 text-xs text-slate-500">
                    <span>
                      Página {pickerPage} de {pickerResults.meta.totalPages}
                    </span>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" disabled={pickerPage <= 1} onClick={() => fetchPickerPage(pickerPage - 1)}>
                        Anterior
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pickerPage >= pickerResults.meta.totalPages}
                        onClick={() => fetchPickerPage(pickerPage + 1)}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="grid w-full grid-cols-2 gap-3 md:contents">
          <Field label="Fecha inicio" {...(dateError ? { error: dateError } : {})}>
            <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
          </Field>
          <Field label="Fecha fin">
            <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
          </Field>
        </div>

        <Button
          type="button"
          className="w-full md:w-auto"
          variant={allMovementsMode ? 'primary' : 'secondary'}
          onClick={() => {
            if (allMovementsMode) {
              setAllMovementsMode(false);
            } else {
              resetSelection();
              setAllMovementsMode(true);
            }
          }}
        >
          Ver todos
        </Button>
      </div>

      {/* --- producto seleccionado --- */}
      {selectedProduct && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sky-500" />
                Producto seleccionado
              </p>
              <button
                type="button"
                onClick={resetSelection}
                className="inline-flex items-center gap-1 rounded-md px-1 text-sm font-semibold text-red-600 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                Quitar selección
                <span aria-hidden="true">×</span>
              </button>
            </div>

            {/* Same order as a search result: the variant's code to the left of the product name. */}
            <div className="flex flex-wrap items-center gap-3">
              {selectedVariantSku && (
                <span className="shrink-0 whitespace-nowrap rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-mono text-sm font-bold text-cyan-700">
                  {selectedVariantSku}
                </span>
              )}
              <h3 className="min-w-0 text-xl font-bold text-slate-900">{selectedProduct.name}</h3>
            </div>

            {variants.length > 1 && (
              <Field label="Variante">
                <Select value={selectedVariantId} disabled={variantsLoading} onChange={(event) => selectVariant(event.target.value)}>
                  <option value="">Elegir una variante…</option>
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.sku}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {selectedVariantId && variantLocations.length > 1 && (
              <Field label="Almacén">
                <Select value={selectedLocationId} disabled={locationsLoading} onChange={(event) => setSelectedLocationId(event.target.value)}>
                  <option value="">Elegir un almacén…</option>
                  <option value={ALL_LOCATIONS}>Todos los almacenes</option>
                  {variantLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.warehouseName} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {selectedLocation && variantLocations.length <= 1 && (
              <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true">
                  <path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <span>
                  Almacén: <span className="text-slate-900">{selectedLocation.warehouseName} — {selectedLocation.name}</span>
                </span>
              </p>
            )}

            {allLocationsSelected && selectedVariantId && (
              <div className="border-t border-slate-100 pt-4">
                <KardexAllLocations
                  productVariantId={selectedVariantId}
                  locations={variantLocations}
                  {...(dateFrom ? { from: `${dateFrom}T00:00:00.000Z` } : {})}
                  {...(dateTo ? { to: nextDayStartUtc(dateTo) } : {})}
                />
              </div>
            )}

            {/* Stock · Costo promedio · Valor: always side by side, one row. */}
            {kardexData && !allLocationsSelected && (
              <div className={`grid gap-2 ${showCost ? 'grid-cols-3' : 'max-w-[12rem] grid-cols-1'}`}>
                <div className={STAT_BOX}>
                  <p className={STAT_LABEL}>Stock disponible</p>
                  <p className={STAT_VALUE}>{kardexData.closing.stockUnits}</p>
                </div>
                {showCost && (
                  <>
                    <div className={STAT_BOX}>
                      <p className={STAT_LABEL}>Costo promedio</p>
                      <p className={STAT_VALUE}>${money(kardexData.closing.averageCost)}</p>
                    </div>
                    <div className={STAT_BOX}>
                      <p className={STAT_LABEL}>Valor</p>
                      <p className={STAT_VALUE}>${money(kardexData.closing.stockValue)}</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* --- kardex --- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{allMovementsMode ? 'Todos los movimientos' : 'Kardex'}</h2>
          {!allMovementsMode && kardexData && exportQuery && (
            /* Icon-only per owner feedback, top-right of the table instead of two full-width
               buttons below it; shared with Formas de pago (`components/export-icons.tsx`). */
            <ExportLinks excelHref={buildKardexExportHref(exportQuery, 'xlsx')} pdfHref={buildKardexExportHref(exportQuery, 'pdf')} />
          )}
        </div>

        {allMovementsMode && (
          <KardexAllMovements
            locations={locations}
            onSelectRow={selectRowFromAllMovements}
            {...(dateFrom ? { occurredFrom: `${dateFrom}T00:00:00.000Z` } : {})}
            {...(dateTo ? { occurredTo: nextDayStartUtc(dateTo) } : {})}
          />
        )}

        {!allMovementsMode && !selectedProduct && <EmptyState title="Busca un producto para consultar su kardex" description="O haz clic en “Ver todos” para ver los movimientos de todos los productos." />}

        {selectedProduct && variantsLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Cargando variantes…
          </div>
        )}

        {selectedProduct && !variantsLoading && variants.length > 1 && !selectedVariantId && (
          <EmptyState title="Elige una variante para ver su kardex" />
        )}

        {selectedVariantId && locationsLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Cargando almacenes…
          </div>
        )}

        {selectedVariantId && !locationsLoading && variantLocations.length > 1 && !selectedLocationId && (
          <EmptyState title="Elige un almacén para ver su kardex" />
        )}

        {selectedVariantId && !locationsLoading && variantLocations.length === 0 && (
          <EmptyState title="Esta variante no tiene almacenes disponibles en este tenant" />
        )}

        {allLocationsSelected && (
          <EmptyState
            title="Mostrando los totales de todos los almacenes"
            description="El kardex es por almacén: elige uno para ver sus movimientos."
          />
        )}

        {selectedLocationId && !allLocationsSelected && kardexLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Cargando kardex…
          </div>
        )}

        {selectedLocationId && !kardexLoading && kardexError !== null && <ErrorState error={kardexError} onRetry={fetchKardex} />}

        {selectedLocationId && !kardexLoading && kardexError === null && kardexData && (
          <KardexTable data={kardexData} sortDescending={sortDescending} onToggleSort={() => setSortDescending((current) => !current)} />
        )}
      </section>

      {/* --- stock por sucursal --- */}
      {selectedVariantId && kardexData && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Stock por sucursal</h2>
          <KardexStockByLocation rows={kardexData.stockByLocation} />
        </section>
      )}
    </div>
  );
}
