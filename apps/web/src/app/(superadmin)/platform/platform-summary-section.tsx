import type { PlatformSummary } from '../../../lib/types/platform-summary';

/** A small, honest error surface local to the metrics section — never a full-page failure. The
 * `(superadmin)` layout already handles a 401 (redirect) and a hard failure (error.tsx); this is
 * for a transient `GET /platform/summary` failure that should not blank the whole home page. */
export function PlatformSummaryError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">Could not load platform metrics</p>
      <p className="mt-0.5 text-sm text-red-700">{message}</p>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * F18-10 — the "minimal, supported" SuperAdmin platform dashboard (dashboards.md §4). Every tile is
 * a `COUNT(*)` over the `tenants` table alone — no tenant-scoped data, no billing (both blocked:
 * `GAP-PLATFORM-AGGREGATE` / `GAP-SA-BILLING`). KPI tiles only, no chart. `newMonthLabel` is the
 * caller-resolved label for the `[from, to)` window it requested (the platform has no single tenant
 * timezone, so the window is computed in UTC and the label says so).
 */
export function PlatformSummarySection({
  summary,
  newWindowLabel,
}: {
  summary: PlatformSummary;
  newWindowLabel: string;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Companies" value={String(summary.totalCount)} />
      <Tile label="Active" value={String(summary.byStatus.active)} hint={`${summary.byStatus.suspended} suspended · ${summary.byStatus.archived} archived`} />
      <Tile label="Demo" value={String(summary.demoCount)} />
      <Tile
        label="New"
        value={summary.period ? String(summary.period.newInPeriod) : '—'}
        hint={newWindowLabel}
      />
    </div>
  );
}
