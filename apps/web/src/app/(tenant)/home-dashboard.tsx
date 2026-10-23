import Link from 'next/link';
import { Card, CardBody } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { cn } from '../../lib/cn';
import type { HomeHighlight, HomeIcon, HomeTile, HomeTopProductsCard } from '../../lib/home/dashboard';

/**
 * Pure presentation for the operational Home. Takes an already-resolved `HomeDashboard` (fetching
 * lives in `lib/home/dashboard.ts`) — no chart, no client state, no `dangerouslySetInnerHTML`.
 *
 * Card states: `ready` → the real value; `unavailable` → "—" with "No disponible por ahora" (an
 * endpoint failed — never shown as `0`); `no-access` → the card is not rendered at all (the page
 * filters those out before calling in).
 */

/** `$48.668,50` — es-EC grouping/decimals, the currency code coming from the real response. */
export function formatMoney(value: number, currency?: string): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: currency ?? 'USD' }).format(value);
}

function formatTileValue(tile: HomeTile): string {
  return tile.format === 'currency' ? formatMoney(tile.value, tile.currency) : tile.value.toLocaleString('es');
}

const ICON_PATHS: Record<HomeIcon, React.ReactNode> = {
  box: (
    <>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.01" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 2v20" />
      <path d="M17 6.5C16 5 14.3 4.5 12 4.5c-2.8 0-4.5 1.2-4.5 3s1.6 2.7 4.5 3.3 4.5 1.4 4.5 3.2-1.8 3-4.5 3c-2.4 0-4.2-.6-5.2-2.3" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.4 11h10.2L20 7H6.2" />
      <circle cx="9" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  trend: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
};

function Icon({ name, className }: { name: HomeIcon; className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

const TONE_CLASSES: Record<NonNullable<HomeTile['tone']>, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  rose: 'bg-rose-50 text-rose-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
};

export function HomeKpiCard({ tile }: { tile: HomeTile }): React.JSX.Element {
  return (
    <Link
      href={tile.href}
      className="group flex min-h-[108px] flex-col justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{tile.label}</p>
        {tile.icon && (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TONE_CLASSES[tile.tone ?? 'indigo'])}>
            <Icon name={tile.icon} className="h-4 w-4" />
          </span>
        )}
      </div>
      <div>
        {tile.state === 'ready' ? (
          <p className="text-xl font-bold tabular-nums text-slate-900">{formatTileValue(tile)}</p>
        ) : (
          <p className="text-xl font-bold text-slate-300" title="No se pudo determinar">
            —
          </p>
        )}
        {tile.state === 'unavailable' && <p className="mt-1 text-xs text-slate-400">No disponible por ahora</p>}
        {tile.state === 'ready' && tile.sub && <p className="mt-1 text-xs font-medium text-slate-700">{tile.sub}</p>}
        {tile.state === 'ready' && tile.note && <p className="mt-1 text-xs text-slate-400">{tile.note}</p>}
      </div>
    </Link>
  );
}

export function HomeKpiGrid({ tiles }: { tiles: HomeTile[] }): React.JSX.Element {
  if (tiles.length === 0) {
    return (
      <EmptyState
        title="Sin módulos operativos para tu rol"
        description="Tu cuenta aún no tiene acceso a ninguno de los reportes resumidos aquí."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {tiles.map((tile) => (
        <HomeKpiCard key={tile.key} tile={tile} />
      ))}
    </div>
  );
}

const ACCENT_CLASSES: Record<HomeHighlight['accent'], { gradient: string; icon: HomeIcon }> = {
  emerald: { gradient: 'from-emerald-500 to-teal-600', icon: 'trend' },
  indigo: { gradient: 'from-indigo-500 to-blue-600', icon: 'cart' },
  orange: { gradient: 'from-amber-500 to-orange-600', icon: 'dollar' },
};

/** The three coloured sales cards (hoy / mes / año). */
export function HomeHighlightCard({ highlight }: { highlight: HomeHighlight }): React.JSX.Element {
  const accent = ACCENT_CLASSES[highlight.accent];
  return (
    <Link
      href={highlight.href}
      className={cn(
        'relative flex min-h-[108px] flex-col justify-center overflow-hidden rounded-2xl bg-gradient-to-br px-6 py-4 text-white shadow-md transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
        accent.gradient,
      )}
    >
      <Icon name={accent.icon} className="pointer-events-none absolute -bottom-4 -right-3 h-24 w-24 text-white/15" />
      <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{highlight.label}</p>
      {highlight.state === 'ready' ? (
        <p className="mt-1 text-3xl font-bold tabular-nums">{formatMoney(highlight.value, highlight.currency)}</p>
      ) : (
        <>
          <p className="mt-1 text-3xl font-bold text-white/60" title="No se pudo determinar">
            —
          </p>
          <p className="text-xs text-white/70">No disponible por ahora</p>
        </>
      )}
    </Link>
  );
}

export function HomeHighlights({ highlights }: { highlights: HomeHighlight[] }): React.JSX.Element | null {
  if (highlights.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {highlights.map((highlight) => (
        <HomeHighlightCard key={highlight.key} highlight={highlight} />
      ))}
    </div>
  );
}

/** The top-10 card — a compact ranked list, still a plain card (no chart). Omitted by the page
 * when `state === 'no-access'`, same convention as the KPI tiles. */
export function HomeTopProducts({ card }: { card: HomeTopProductsCard }): React.JSX.Element {
  if (card.state === 'unavailable') {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-400">No se pudo determinar el top de productos vendidos hoy.</p>
        </CardBody>
      </Card>
    );
  }

  if (card.items.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500">Aún no hay ventas registradas hoy.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="p-4">
        <ol className="flex flex-col divide-y divide-slate-100">
          {card.items.map((item, index) => (
            <li key={item.variantId} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-baseline gap-2 truncate">
                <span className="w-5 shrink-0 text-xs font-medium text-slate-400">{index + 1}</span>
                <span className="truncate text-sm font-medium text-slate-800">{item.productName}</span>
                <span className="shrink-0 text-xs text-slate-400">{item.sku}</span>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{item.quantity}</span>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
