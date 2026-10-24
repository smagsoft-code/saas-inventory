'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import { QrThumbnailModal } from '../../../components/qr-thumbnail-modal';
import { ProductPreviewModal } from './product-preview-modal';
import { Spinner } from '../../../components/ui/spinner';
import { cn } from '../../../lib/cn';
import { VARIANT_STATUS_LABELS, type VariantStatus } from '../../../lib/types/products';
import type { InventoryBalance } from '../../../lib/types/inventory';
import type { ProductCatalogRow } from '../../../lib/types/product-catalog';
import { PRODUCTS_MOBILE_THEMES, type ProductsMobileTheme } from './products-mobile-theme';

/**
 * The phone layout of Productos (`md:hidden` on the page; tablets/desktops keep the table): three KPI
 * tiles, the active-filter chips, and one expandable card per variant — the same data and the same
 * lazy "Existencias" fetch as the desktop table, laid out for a thumb. Colours come from
 * `PRODUCTS_MOBILE_THEMES` (`light` today, `dark` kept ready — see that file).
 */
type Theme = keyof typeof PRODUCTS_MOBILE_THEMES;

const money = (value: number): string => `$${value.toFixed(2)}`;

/** "Color: Vino; Medidas: 200 cm" → [{label:'Color', value:'Vino'}, …] (the line is built server-side). */
export function parseAttributeLine(line: string | undefined): { label: string; value: string }[] {
  if (!line) return [];
  return line
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const at = part.indexOf(':');
      return at > 0 ? [{ label: part.slice(0, at).trim(), value: part.slice(at + 1).trim() }] : [];
    });
}

// --- KPI tiles -----------------------------------------------------------------------------------

export interface ProductsKpiData {
  /** Models (variants) matching the current filters. */
  totalModels: number;
  /** `null` = could not be determined / no permission → shown as "—", never a 0. */
  totalStock: number | null;
  /** Share of the physical stock that is not reserved, 0–100. `null` when unknown. */
  availablePercent: number | null;
  outOfStockCount: number | null;
  firstOutOfStockSku?: string | undefined;
  /** The caption under "Total modelos" (e.g. "Activos"). */
  modelsCaption: string;
}

export function ProductsKpis({ data, theme = 'light' }: { data: ProductsKpiData; theme?: Theme }): React.JSX.Element {
  const t = PRODUCTS_MOBILE_THEMES[theme];
  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Resumen de productos">
      <div className={t.kpi}>
        <p className={t.kpiLabel}>Total modelos</p>
        <p className="mt-1">
          <span className={t.kpiValue}>{data.totalModels.toLocaleString('es')}</span> <span className={t.kpiUnit}>items</span>
        </p>
        <p className={cn('mt-1 truncate', t.kpiGood)}>{data.modelsCaption}</p>
      </div>
      <div className={t.kpi}>
        <p className={t.kpiLabel}>Stock total</p>
        <p className="mt-1">
          <span className={cn(t.kpiValue, data.totalStock !== null && 'text-emerald-600')}>{data.totalStock === null ? '—' : data.totalStock.toLocaleString('es')}</span>{' '}
          <span className={t.kpiUnit}>un.</span>
        </p>
        <p className={cn('mt-1 truncate', t.kpiGood)}>{data.availablePercent === null ? 'No disponible' : `${data.availablePercent}% disp.`}</p>
      </div>
      <div className={t.kpi}>
        <p className={t.kpiLabel}>Sin stock</p>
        <p className="mt-1">
          <span className={t.kpiValue}>{data.outOfStockCount === null ? '—' : data.outOfStockCount.toLocaleString('es')}</span>{' '}
          <span className={t.kpiUnit}>{data.outOfStockCount === 1 ? 'modelo' : 'modelos'}</span>
        </p>
        <p className={cn('mt-1 truncate', t.kpiWarn)}>{data.firstOutOfStockSku ? `⚠ ${data.firstOutOfStockSku}` : data.outOfStockCount === 0 ? 'Todo con stock' : ' '}</p>
      </div>
    </div>
  );
}

// --- active-filter chips -------------------------------------------------------------------------

export interface ProductsChip {
  key: string;
  label: string;
  /** The same list without this filter. */
  removeHref: string;
  tone: 'neutral' | 'accent' | 'alt';
}

export function ProductsChips({ chips, theme = 'light' }: { chips: ProductsChip[]; theme?: Theme }): React.JSX.Element | null {
  if (chips.length === 0) return null;
  const t = PRODUCTS_MOBILE_THEMES[theme];
  const toneClass = { neutral: t.chip, accent: t.chipAccent, alt: t.chipAlt };
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Filtros activos">
      <span className={t.chipsLabel}>Activos:</span>
      {chips.map((chip) => (
        <Link key={chip.key} href={chip.removeHref} aria-label={`Quitar filtro ${chip.label}`} className={toneClass[chip.tone]}>
          {chip.label}
          <span aria-hidden="true">×</span>
        </Link>
      ))}
    </div>
  );
}

// --- the cards -----------------------------------------------------------------------------------

interface BalancesState {
  status: 'loading' | 'ready' | 'error';
  rows: InventoryBalance[];
  error?: string;
}

/** The product photo (or the same empty placeholder as the web table) — click opens the summary. */
function Thumb({ t, src }: { t: ProductsMobileTheme; src?: string | undefined }): React.JSX.Element {
  if (src) {
    return <img src={src} alt="" className={t.thumb} />;
  }
  return (
    <div className={t.thumbEmpty} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5-9 9" />
      </svg>
    </div>
  );
}

function Tile({ t, label, children }: { t: ProductsMobileTheme; label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={t.tile}>
      <p className={t.tileLabel}>{label}</p>
      {children}
    </div>
  );
}

export function ProductsMobileList({
  rows,
  total,
  categoryNames,
  attributeLineByVariant,
  qrValueByVariant,
  canManage,
  canViewInventory,
  locationNames,
  locationWarehouseNames,
  theme = 'light',
}: {
  rows: ProductCatalogRow[];
  /** Models matching the filters across all pages. */
  total: number;
  categoryNames: Map<string, string>;
  attributeLineByVariant?: Map<string, string> | undefined;
  qrValueByVariant: Map<string, string>;
  canManage: boolean;
  canViewInventory: boolean;
  locationNames: Map<string, string>;
  locationWarehouseNames: Map<string, string>;
  theme?: Theme;
}): React.JSX.Element {
  const t = PRODUCTS_MOBILE_THEMES[theme];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [balances, setBalances] = useState<Record<string, BalancesState>>({});

  function toggle(variantId: string): void {
    const willOpen = !open.has(variantId);
    setOpen((cur) => {
      const next = new Set(cur);
      if (willOpen) next.add(variantId);
      else next.delete(variantId);
      return next;
    });
    if (willOpen && canViewInventory && !balances[variantId]) {
      setBalances((cur) => ({ ...cur, [variantId]: { status: 'loading', rows: [] } }));
      apiFetch<{ data: InventoryBalance[] }>('/api/v1/inventory/balances', { query: { productVariantId: variantId, pageSize: 100 } })
        .then((page) => setBalances((cur) => ({ ...cur, [variantId]: { status: 'ready', rows: page.data } })))
        .catch((err: unknown) => setBalances((cur) => ({ ...cur, [variantId]: { status: 'error', rows: [], error: httpErrorMessage(err) } })));
    }
  }

  return (
    <section aria-label="Productos" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={t.count}>
          {total.toLocaleString('es')} {total === 1 ? 'modelo encontrado' : 'modelos encontrados'}
        </h2>
        <span className={t.hint}>Toca para expandir detalle</span>
      </div>

      {rows.map((row) => {
        const isOpen = open.has(row.variantId);
        const out = row.availableQuantity <= 0;
        const attributes = parseAttributeLine(attributeLineByVariant?.get(row.variantId));
        const category = categoryNames.get(row.categoryId ?? '');
        const qrValue = qrValueByVariant.get(row.variantId);
        const state = balances[row.variantId];
        const margin = row.maxPrice - row.basePrice;
        const panelId = `product-detail-${row.variantId}`;
        return (
          <article key={row.variantId} className={out ? t.cardOut : t.card}>
            <div className="flex items-start gap-3 p-4">
              {/* The photo opens the same summary as on the web table (ProductPreviewModal). */}
              <ProductPreviewModal
                productId={row.productId}
                variantId={row.variantId}
                productName={row.productName}
                sku={row.sku}
                categoryName={category}
                thumbnailUrl={row.thumbnailUrl}
                detailHref={`/products/${row.productId}/variants/${row.variantId}`}
                canManage={canManage}
              >
                <Thumb t={t} src={row.thumbnailUrl} />
              </ProductPreviewModal>
              <button
                type="button"
                onClick={() => toggle(row.variantId)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-label={`${row.sku} ${row.productName}`}
                className="flex min-w-0 flex-1 flex-col gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={out ? t.codeOut : t.code}>{row.sku}</span>
                    <span className={t.dot} aria-hidden="true">
                      •
                    </span>
                    <span className={out ? t.stockLineOut : t.stockLine}>{out ? 'Agotado' : `En stock (${row.availableQuantity} un.)`}</span>
                  </span>
                  <span className="shrink-0">
                    <span className={out ? t.priceOut : t.price}>{money(row.maxPrice).slice(1)}</span> <span className={t.currency}>USD</span>
                  </span>
                </span>
                <span className={t.title}>{row.productName}</span>
                {category && <span className={t.meta}>Categoría: {category}</span>}
                <span className={cn('flex items-center justify-between gap-2 border-t pt-2', t.divider)}>
                  <span className="flex flex-wrap gap-2">
                    <span className={out ? t.badgeOut : t.badgeStock}>{out ? '0 un. (Agotado)' : `${row.availableQuantity} en stock`}</span>
                    <span className={t.badgeStatus}>{VARIANT_STATUS_LABELS[row.status as VariantStatus] ?? row.status}</span>
                    {out && <span className={t.badgeUrgent}>Reponer</span>}
                  </span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={cn('h-5 w-5 shrink-0 transition-transform', t.chevron, isOpen && 'rotate-180')} aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>
            </div>

            {isOpen && (
              <div id={panelId} className={cn('flex flex-col gap-3 rounded-b-2xl p-4', t.detail)}>
                {attributes.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {attributes.map((attribute) => (
                      <Tile key={attribute.label} t={t} label={attribute.label}>
                        <p className={t.tileValue}>{attribute.value}</p>
                      </Tile>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Tile t={t} label="Precio base">
                    <p className={t.tileValueMono}>{money(row.basePrice)}</p>
                  </Tile>
                  <Tile t={t} label="Margen est.">
                    <p className={t.tileValueGood}>
                      {margin >= 0 ? '+' : '−'}
                      {money(Math.abs(margin))}
                    </p>
                  </Tile>
                </div>

                {canViewInventory ? (
                  <Tile t={t} label="Ubicación">
                    {!state || state.status === 'loading' ? (
                      <p className={cn('flex items-center gap-2', t.tileValueMono)}>
                        <Spinner className="h-3 w-3" /> Cargando existencias…
                      </p>
                    ) : state.status === 'error' ? (
                      <p className="mt-1 text-sm text-red-600">{state.error}</p>
                    ) : state.rows.length === 0 ? (
                      <p className={t.tileValueMono}>Sin existencias registradas.</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1">
                        {state.rows.map((balance) => (
                          <li key={balance.id} className="flex items-baseline justify-between gap-3 text-sm">
                            <Link href={`/inventory/${balance.id}`} className={cn('min-w-0 truncate', t.tileValue.replace('mt-1 ', ''))}>
                              {[locationWarehouseNames.get(balance.locationId), locationNames.get(balance.locationId) ?? balance.locationId].filter(Boolean).join(' · ')}
                            </Link>
                            <span className={cn('shrink-0 font-mono', balance.quantityAvailable > 0 ? 'text-emerald-600' : 'text-red-600')}>{balance.quantityAvailable} un.</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Tile>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  {qrValue ? (
                    <div className={cn(t.secondaryButton, 'gap-3')}>
                      <QrThumbnailModal value={qrValue} label={`${row.productName} — ${row.sku}`} maxPrice={row.maxPrice} />
                      <span>Código QR</span>
                    </div>
                  ) : (
                    <Link href={`/qr/new?productId=${row.productId}&variantId=${row.variantId}`} className={t.secondaryButton}>
                      Generar QR
                    </Link>
                  )}
                  <Link href={`/products/${row.productId}/variants/${row.variantId}`} className={t.primaryButton}>
                    {canManage ? 'Editar producto' : 'Ver producto'} <span aria-hidden="true">›</span>
                  </Link>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
