'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { buildKardexExportHref, getKardex } from '../../../lib/inventory/kardex';
import type { KardexResponse } from '../../../lib/types/kardex';
import { Button, Card, CardBody, EmptyState, ErrorState, Field, Input, Select, Spinner } from '../../../components/ui';
import { KardexAllMovements } from './kardex-all-movements';
import { KardexStockByLocation } from './kardex-stock-by-location';
import { KardexTable } from './kardex-table';

interface ProductOption {
  id: string;
  name: string;
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

// Plain inline SVGs, not an icon library — this design system doesn't use one anywhere else
// ("sin librerías visuales innecesarias"), and two glyphs don't justify adding one.
function ExcelIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 8h14M3 13h14M8.33 3v14M13.67 3v14" />
    </svg>
  );
}

function PdfIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 2.5h5.5L15 6v11a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-14a.5.5 0 0 1 .5-.5Z" strokeLinejoin="round" />
      <path d="M11.5 2.5V6H15" strokeLinejoin="round" />
      <path d="M7 10.5h6M7 13h6" strokeLinecap="round" />
    </svg>
  );
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
  const [pickerResults, setPickerResults] = useState<{ data: ProductOption[]; meta: { total: number; totalPages: number } } | null>(null);
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
    apiFetch<{ data: ProductOption[]; meta: { total: number; totalPages: number } }>('/api/v1/products', {
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

  function selectProduct(product: ProductOption): void {
    resetSelection();
    setAllMovementsMode(false);
    setSelectedProduct(product);
    setPickerOpen(false);
    setQuery('');
    setVariantsLoading(true);
    apiFetch<VariantOption[]>(`/api/v1/products/${product.id}/variants`)
      .then((rows) => {
        setVariants(rows);
        if (rows.length === 1 && rows[0]) {
          selectVariant(rows[0].id);
        }
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
  const exportQuery = selectedVariantId && selectedLocationId
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
              <CardBody className="flex flex-col gap-1 p-2">
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
                  pickerResults?.data.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => selectProduct(product)}
                      className="rounded-md px-2 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                    >
                      {product.name}
                    </button>
                  ))}
                {!pickerLoading && pickerResults && pickerResults.meta.totalPages > 1 && (
                  <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
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
              </CardBody>
            </Card>
          )}
        </div>

        <Field label="Fecha inicio" {...(dateError ? { error: dateError } : {})}>
          <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
        </Field>
        <Field label="Fecha fin">
          <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
        </Field>

        <Button
          type="button"
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
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Producto seleccionado</p>
                <p className="text-base font-semibold text-slate-900">{selectedProduct.name}</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
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
                      {variantLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.warehouseName} — {location.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {selectedLocation && variantLocations.length <= 1 && (
                  <p className="text-sm text-slate-500">
                    Almacén: <span className="text-slate-900">{selectedLocation.warehouseName} — {selectedLocation.name}</span>
                  </p>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={resetSelection}>
                  Quitar selección
                </Button>
              </div>
            </div>

            {kardexData && (
              <div className="flex flex-wrap gap-6 border-t border-slate-100 pt-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stock disponible</p>
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{kardexData.closing.stockUnits}</p>
                </div>
                {showCost && (
                  <>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Costo promedio</p>
                      <p className="text-2xl font-semibold tabular-nums text-slate-900">${money(kardexData.closing.averageCost)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Valor</p>
                      <p className="text-2xl font-semibold tabular-nums text-slate-900">${money(kardexData.closing.stockValue)}</p>
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
            <div className="flex gap-1.5">
              {/* Plain same-origin `<a>`s, not Next's `Link` — these navigate to a binary download
                  (Content-Disposition: attachment), the same convention `import-upload-form.tsx`'s
                  template download already uses. Icon-only per owner feedback, top-right of the
                  table instead of two full-width buttons below it. */}
              <a
                href={buildKardexExportHref(exportQuery, 'xlsx')}
                title="Exportar a Excel"
                aria-label="Exportar a Excel"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-green-700 hover:bg-slate-50"
              >
                <ExcelIcon />
              </a>
              <a
                href={buildKardexExportHref(exportQuery, 'pdf')}
                title="Exportar a PDF"
                aria-label="Exportar a PDF"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-red-700 hover:bg-slate-50"
              >
                <PdfIcon />
              </a>
            </div>
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

        {selectedLocationId && kardexLoading && (
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
