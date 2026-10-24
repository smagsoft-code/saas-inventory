import Link from 'next/link';
import type { ReactNode } from 'react';
import type { HomeDashboard, HomeHighlight, HomeTile } from '../../lib/home/dashboard';
import { cn } from '../../lib/cn';
import { formatMoney, HomeTopProducts } from './home-dashboard';
import { HomeLocationFilter } from './home-location-filter';
import { SalesTrendChart } from './sales-trend-chart';

/**
 * The phone layout of Home (`md:hidden`; tablets and desktops keep the card grid). The same
 * `HomeDashboard` the desktop page reads — no extra request, same permission gating and per-card
 * degradation ("—" with "No disponible por ahora", never a fake 0; a no-access card is not rendered):
 *
 *  - a navy hero: greeting, the "Inicio" title, the year chip, the Almacén pill, the month's sales
 *    in large type and a Costo neto / Ganancia strip;
 *  - "Ventas" and "Inventario" cards made of compact rows;
 *  - the monthly sales chart and the top-10 of today, unchanged.
 *
 * The hero bleeds to the screen edges by cancelling `<main>`'s own padding (`-mx-4 -mt-6`).
 */

function find<T extends { key: string }>(items: T[], key: string): T | undefined {
  return items.find((item) => item.key === key);
}

function Glyph({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className ?? 'h-5 w-5'}>
      {children}
    </svg>
  );
}

const ICONS = {
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6L5 8z" />
      <path d="M9 8V6a3 3 0 016 0v2" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 3v18" />
      <path d="M16.5 7C15.6 5.8 14 5.2 12 5.2c-2.5 0-4 1.1-4 2.8s1.5 2.4 4 3 4 1.3 4 3-1.6 2.8-4 2.8c-2.1 0-3.7-.6-4.6-2" />
    </>
  ),
  box: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.4 11h10.2L20 7H6.2" />
      <circle cx="9" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </>
  ),
} as const;

function value(item: { state: string; value: number; format?: 'currency' | 'count'; currency?: string | undefined }): string {
  if (item.state !== 'ready') return '—';
  return item.format === 'count' ? item.value.toLocaleString('es') : formatMoney(item.value, item.currency);
}

/** A row of a white card: coloured icon badge, title + caption, the value on the right. */
function Row({
  href,
  icon,
  tone,
  title,
  caption,
  shown,
  unavailable,
}: {
  href: string;
  icon: keyof typeof ICONS;
  tone: string;
  title: string;
  caption?: string | undefined;
  shown: string;
  unavailable: boolean;
}): React.JSX.Element {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tone)}>
        <Glyph>{ICONS[icon]}</Glyph>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-slate-900">{title}</span>
        {unavailable ? (
          <span className="block text-xs text-slate-400">No disponible por ahora</span>
        ) : (
          caption && <span className="block truncate text-xs text-slate-500">{caption}</span>
        )}
      </span>
      <span className={cn('shrink-0 text-2xl font-bold tabular-nums', unavailable ? 'text-slate-300' : 'text-slate-900')}>{shown}</span>
    </Link>
  );
}

function SectionTitle({ children }: { children: ReactNode }): React.JSX.Element {
  return <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h2>;
}

export function HomeMobile({
  fullName,
  dashboard,
  chartYear,
}: {
  fullName: string;
  dashboard: HomeDashboard;
  chartYear?: string | undefined;
}): React.JSX.Element {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  const visibleTiles = dashboard.tiles.filter((t) => t.state !== 'no-access');
  const visibleHighlights = dashboard.highlights.filter((h) => h.state !== 'no-access');

  const month: HomeHighlight | undefined = find(visibleHighlights, 'sales-month');
  const today = find(visibleHighlights, 'sales-today');
  const yearSales = find(visibleHighlights, 'sales-year');
  const netCost: HomeTile | undefined = find(visibleTiles, 'net-cost-month');
  const inventoryValue = find(visibleTiles, 'inventory-value');
  const products = find(visibleTiles, 'total-products');
  const profit = netCost?.sub?.replace(/^Ganancia:\s*/i, '');

  const salesRows = [today, yearSales].filter((h): h is HomeHighlight => Boolean(h));
  const nothingAtAll = visibleTiles.length === 0 && visibleHighlights.length === 0;

  return (
    <div className="-mx-4 -mt-6 flex flex-col gap-6 sm:-mx-6">
      <section aria-label="Resumen" className="flex flex-col gap-5 bg-[#141f3d] px-5 pb-6 pt-5 text-white">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-300">Hola, {firstName}</p>
            <h1 className="text-4xl font-bold tracking-tight">Inicio</h1>
          </div>
          <span className="mb-1 flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold">
            <Glyph className="h-4 w-4">{ICONS.calendar}</Glyph>
            {dashboard.trend.year}
          </span>
        </div>

        {dashboard.locationOptions.length > 0 && (
          <HomeLocationFilter
            variant="dark"
            options={dashboard.locationOptions}
            {...(dashboard.selectedLocationId ? { selectedLocationId: dashboard.selectedLocationId } : {})}
            {...(chartYear ? { chartYear } : {})}
          />
        )}

        {month && (
          <Link href={month.href} className="flex flex-col gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                <span aria-hidden="true" className="h-4 w-1 rounded-full bg-indigo-500" />
                {month.label}
              </span>
              <Glyph className="h-6 w-6 text-slate-300">{ICONS.cart}</Glyph>
            </span>
            <span className={cn('text-5xl font-bold tabular-nums tracking-tight', month.state !== 'ready' && 'text-white/40')} title={month.state !== 'ready' ? 'No se pudo determinar' : undefined}>
              {value(month)}
            </span>
            {month.state === 'unavailable' && <span className="text-xs text-slate-400">No disponible por ahora</span>}
          </Link>
        )}

        {netCost && (
          <div className="grid grid-cols-2 rounded-2xl bg-white/[0.07] px-5 py-4">
            <div className="pr-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{netCost.label}</p>
              <p className={cn('mt-1 text-2xl font-bold tabular-nums', netCost.state !== 'ready' && 'text-white/40')}>{value(netCost)}</p>
            </div>
            <div className="border-l border-white/10 pl-5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Ganancia</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">{netCost.state === 'ready' && profit ? profit : '—'}</p>
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-6 px-4 sm:px-6">
        {nothingAtAll && (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Tu cuenta aún no tiene acceso a ninguno de los reportes resumidos aquí.
          </p>
        )}

        {salesRows.length > 0 && (
          <section aria-label="Ventas">
            <SectionTitle>Ventas</SectionTitle>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              {salesRows.map((row) => (
                <Row
                  key={row.key}
                  href={row.href}
                  icon={row.key === 'sales-today' ? 'calendar' : 'bag'}
                  tone={row.key === 'sales-today' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}
                  title={row.label}
                  caption={row.key === 'sales-today' ? 'Total del día' : undefined}
                  shown={value(row)}
                  unavailable={row.state === 'unavailable'}
                />
              ))}
            </div>
          </section>
        )}

        {(inventoryValue || products) && (
          <section aria-label="Inventario">
            <SectionTitle>Inventario</SectionTitle>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              {inventoryValue && (
                <Link href={inventoryValue.href} className="flex items-center justify-between gap-3 px-5 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900">
                  <span className="min-w-0">
                    <span className="block text-xs font-medium uppercase tracking-wider text-slate-500">{inventoryValue.label}</span>
                    <span className={cn('mt-1 block text-4xl font-bold tabular-nums tracking-tight', inventoryValue.state === 'ready' ? 'text-slate-900' : 'text-slate-300')}>{value(inventoryValue)}</span>
                    {inventoryValue.state === 'unavailable' && <span className="block text-xs text-slate-400">No disponible por ahora</span>}
                    {inventoryValue.state === 'ready' && inventoryValue.note && <span className="mt-1 block text-xs text-slate-400">{inventoryValue.note}</span>}
                  </span>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Glyph className="h-6 w-6">{ICONS.dollar}</Glyph>
                  </span>
                </Link>
              )}
              {products && (
                <Row
                  href={products.href}
                  icon="box"
                  tone="bg-emerald-50 text-emerald-600"
                  title="Productos"
                  caption={products.state === 'ready' && products.note ? products.note : 'Total de productos'}
                  shown={value(products)}
                  unavailable={products.state === 'unavailable'}
                />
              )}
            </div>
          </section>
        )}

        {dashboard.trend.state !== 'no-access' && <SalesTrendChart trend={dashboard.trend} locationId={dashboard.selectedLocationId} />}

        {dashboard.topProducts.state !== 'no-access' && (
          <section aria-labelledby="home-top-products-m" className="flex flex-col gap-3">
            <h2 id="home-top-products-m" className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Top 10 productos vendidos hoy
            </h2>
            <HomeTopProducts card={dashboard.topProducts} />
          </section>
        )}
      </div>
    </div>
  );
}
