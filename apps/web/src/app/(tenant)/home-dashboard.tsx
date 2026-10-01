import Link from 'next/link';
import { Card, CardBody } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import type { HomeTile, HomeTopProductsCard } from '../../lib/home/dashboard';

/**
 * Pure presentation for the operational Home (OUI-002). Takes an already-resolved `HomeDashboard`
 * (fetching lives in `lib/home/dashboard.ts`) and renders the KPI-card grid plus the top-10 card —
 * no chart, no client state, no `dangerouslySetInnerHTML`.
 *
 * Tile states: `ready` → the real value; `unavailable` → "No disponible" (an endpoint failed —
 * never shown as `0`, an optional `note` can explain why); `no-access` → the tile is not rendered
 * at all (the page filters those out before calling in).
 */

function formatTileValue(tile: HomeTile): string {
  if (tile.format === 'currency') {
    const amount = tile.value.toFixed(2);
    return tile.currency ? `${amount} ${tile.currency}` : amount;
  }
  return tile.value.toLocaleString('es');
}

function KpiValue({ tile }: { tile: HomeTile }): React.JSX.Element {
  if (tile.state === 'ready') {
    return <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{formatTileValue(tile)}</p>;
  }
  return (
    <p className="mt-2 text-2xl font-semibold text-slate-300" title="No se pudo determinar">
      —
    </p>
  );
}

export function HomeKpiCard({ tile }: { tile: HomeTile }): React.JSX.Element {
  const unavailable = tile.state === 'unavailable';
  return (
    <Link
      href={tile.href}
      className="group rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{tile.label}</p>
      <KpiValue tile={tile} />
      {unavailable && (
        <p className="mt-1 text-xs text-slate-400">No disponible por ahora</p>
      )}
      {tile.state === 'ready' && tile.note && <p className="mt-1 text-xs text-slate-400">{tile.note}</p>}
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <HomeKpiCard key={tile.key} tile={tile} />
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
