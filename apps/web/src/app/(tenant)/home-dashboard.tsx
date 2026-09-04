import Link from 'next/link';
import { Card, CardBody } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import type { HomeTile } from '../../lib/home/dashboard';

/**
 * Pure presentation for the operational Home (F17-12). Takes an already-resolved `HomeDashboard`
 * (fetching lives in `lib/home/dashboard.ts`) and renders the three F17-01 zones: KPI tiles, a
 * "Needs attention" digest, and quick actions. No data fetching, no state, no `dangerouslySetInnerHTML`.
 *
 * Tile states: `ready` → the real number; `unavailable` → "No disponible" (an endpoint failed —
 * never shown as `0`, an optional `note` can explain why); `no-access` → the tile is not rendered
 * at all (the page filters those out before calling in).
 */

function KpiValue({ tile }: { tile: HomeTile }): React.JSX.Element {
  if (tile.state === 'ready') {
    const tone =
      tile.actionable && tile.count > 0 ? 'text-amber-700' : 'text-slate-900';
    return <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone}`}>{tile.count}</p>;
  }
  return (
    <p className="mt-2 text-2xl font-semibold text-slate-300" title="Could not be determined">
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
        <p className="mt-1 text-xs text-slate-400">{tile.note ?? 'Not available right now'}</p>
      )}
    </Link>
  );
}

export function HomeKpiGrid({ tiles }: { tiles: HomeTile[] }): React.JSX.Element {
  if (tiles.length === 0) {
    return (
      <EmptyState
        title="No operational modules for your role"
        description="Your account does not have access to any of the modules summarised here yet."
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

/** The "Needs attention" digest — only queue tiles that are `ready` with a non-zero count and at
 * least one preview row. */
export function HomeAttention({ tiles }: { tiles: HomeTile[] }): React.JSX.Element {
  const queues = tiles.filter(
    (t) => t.state === 'ready' && t.count > 0 && t.items.length > 0,
  );

  if (queues.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500">
            Nothing needs your attention right now. Open queues — orders, approvals, returns,
            transfers, imports — appear here when they have items.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {queues.map((tile) => (
        <Card key={tile.key}>
          <CardBody className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {tile.label}
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {tile.count}
                </span>
              </h3>
              <Link
                href={tile.href}
                className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
              >
                View all
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-slate-100">
              {tile.items.map((item) => (
                <li key={item.id} className="py-2">
                  <Link
                    href={item.href}
                    className="flex items-baseline justify-between gap-3 text-sm underline-offset-2 hover:underline"
                  >
                    <span className="shrink-0 font-medium text-slate-800">{item.primary}</span>
                    {item.secondary && (
                      <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-500">
                        {item.secondary}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            {tile.count > tile.items.length && (
              <p className="mt-2 text-xs text-slate-400">
                Showing {tile.items.length} of {tile.count}.
              </p>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function HomeQuickActions({
  actions,
}: {
  actions: { label: string; href: string }[];
}): React.JSX.Element | null {
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {action.label}
        </Link>
      ))}
    </div>
  );
}
