'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Select } from '../../components/ui/input';
import type { HomeSalesTrend, HomeTrendPoint } from '../../lib/home/dashboard';

/** Sales = the app's primary colour (the one every primary button uses), costs = orange. The two
 * share ONE axis (same unit), so no dual-axis. Identity is never colour-alone: a legend always names
 * both series, the tooltip names them, and the table view lists every number. */
const SALES_COLOR = '#0f172a';
const COST_COLOR = '#f97316';

const MONTHS_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEPT', 'OCT', 'NOV', 'DIC'];
const MONTHS_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const W = 800;
const H = 300;
const M = { left: 52, right: 16, top: 16, bottom: 28 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

function money(value: number, currency?: string): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: currency ?? 'USD' }).format(value);
}

/** A "nice" axis maximum (1, 2, 2.5, 5 × 10ⁿ) and four evenly spaced ticks from 0. */
function niceScale(maxValue: number): { max: number; ticks: number[] } {
  if (maxValue <= 0) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = maxValue / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
}

interface Pt {
  x: number;
  y: number;
}

/** Monotone cubic (Fritsch–Carlson) path through the points — smooth, never overshooting below the data. */
function smoothPath(points: Pt[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    slope.push((points[i + 1]!.y - points[i]!.y) / dx[i]!);
  }
  const tangent: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    tangent.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  }
  tangent.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
    } else {
      const a = tangent[i]! / slope[i]!;
      const b = tangent[i + 1]! / slope[i]!;
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        tangent[i] = t * a * slope[i]!;
        tangent[i + 1] = t * b * slope[i]!;
      }
    }
  }
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i]! / 3;
    d += ` C${points[i]!.x + h},${points[i]!.y + tangent[i]! * h} ${points[i + 1]!.x - h},${points[i + 1]!.y - tangent[i + 1]! * h} ${points[i + 1]!.x},${points[i + 1]!.y}`;
  }
  return d;
}

/** Contiguous runs of months that have a value (the current year has no data for future months — the
 * line simply stops instead of falling to zero). */
function segments(points: (Pt | null)[]): Pt[][] {
  const result: Pt[][] = [];
  let current: Pt[] = [];
  for (const p of points) {
    if (p) current.push(p);
    else if (current.length > 0) {
      result.push(current);
      current = [];
    }
  }
  if (current.length > 0) result.push(current);
  return result;
}

/**
 * "Tendencia de ventas" — monthly sales vs. net cost for one calendar year (tenant timezone), as two
 * overlapping area charts on a single axis. The year picker re-loads the page (server-side data) via
 * `?year=`, keeping the Almacén filter. Hover/keyboard shows a crosshair and one tooltip with both
 * series; a collapsible table lists the exact numbers. The Costo series exists only for callers
 * holding `pricing.cost.view` (the endpoint omits cost otherwise).
 */
export function SalesTrendChart({
  trend,
  locationId,
}: {
  trend: HomeSalesTrend;
  /** The Almacén currently filtered on Home, so changing the year keeps it. */
  locationId?: string | undefined;
}): React.JSX.Element {
  const router = useRouter();
  const uid = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { points, hasCost, currency } = trend;
  const scale = useMemo(() => {
    const values = points.flatMap((p) => [p.sales, p.cost]).filter((v): v is number => v !== null);
    return niceScale(Math.max(0, ...values));
  }, [points]);

  const x = (i: number): number => M.left + (i * PLOT_W) / 11;
  const y = (v: number): number => M.top + PLOT_H - (v / scale.max) * PLOT_H;
  const baseline = M.top + PLOT_H;

  const salesPts = points.map((p, i) => (p.sales === null ? null : { x: x(i), y: y(p.sales) }));
  const costPts = points.map((p, i) => (p.cost === null || !hasCost ? null : { x: x(i), y: y(p.cost) }));

  function areaPath(segment: Pt[]): string {
    const line = smoothPath(segment);
    return `${line} L${segment[segment.length - 1]!.x},${baseline} L${segment[0]!.x},${baseline} Z`;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    const index = Math.round(((px - M.left) / PLOT_W) * 11);
    setHover(Math.min(11, Math.max(0, index)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowRight') setHover((h) => Math.min(11, (h ?? -1) + 1));
    else if (event.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? 12) - 1));
    else if (event.key === 'Escape') setHover(null);
    else return;
    event.preventDefault();
  }

  const hovered: HomeTrendPoint | null = hover !== null ? (points[hover] ?? null) : null;
  const tooltipLeftPct = hover !== null ? (x(hover) / W) * 100 : 0;

  return (
    <section aria-labelledby="home-trend" className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="home-trend" className="text-base font-semibold text-slate-900">
            Tendencia de ventas
          </h2>
          <p className="text-sm text-slate-500">Comportamiento de ventas por mes en {trend.year}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          Año
          <Select
            aria-label="Año"
            className="w-28"
            value={String(trend.year)}
            onChange={(e) => {
              const params = new URLSearchParams();
              params.set('year', e.target.value);
              if (locationId) params.set('locationId', locationId);
              router.push(`/?${params}`);
            }}
          >
            {trend.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600" aria-label="Leyenda">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SALES_COLOR }} />
          Ventas
        </li>
        {hasCost && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COST_COLOR }} />
            Costo neto
          </li>
        )}
      </ul>

      {trend.state === 'unavailable' ? (
        <p className="mt-6 text-sm text-slate-400">No se pudo cargar la tendencia de ventas por ahora.</p>
      ) : (
        <>
          <div
            ref={wrapRef}
            className="relative mt-2 outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            tabIndex={0}
            role="img"
            aria-label={`Gráfico de ventas${hasCost ? ' y costo neto' : ''} por mes en ${trend.year}. Usa las flechas izquierda y derecha para recorrer los meses.`}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setHover(null)}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true">
              <defs>
                <linearGradient id={`${uid}-sales`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SALES_COLOR} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={SALES_COLOR} stopOpacity="0" />
                </linearGradient>
                <linearGradient id={`${uid}-cost`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COST_COLOR} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={COST_COLOR} stopOpacity="0" />
                </linearGradient>
              </defs>

              {scale.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeDasharray={tick === 0 ? undefined : '3 4'} />
                  <text x={M.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#64748b">
                    {tick.toLocaleString('es-EC')}
                  </text>
                </g>
              ))}
              {MONTHS_SHORT.map((label, i) => (
                <text key={label} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">
                  {label}
                </text>
              ))}

              {segments(salesPts).map((segment, i) => (
                <g key={`s${i}`}>
                  <path d={areaPath(segment)} fill={`url(#${uid}-sales)`} />
                  <path d={smoothPath(segment)} fill="none" stroke={SALES_COLOR} strokeWidth="2" strokeLinecap="round" />
                </g>
              ))}
              {segments(costPts).map((segment, i) => (
                <g key={`c${i}`}>
                  <path d={areaPath(segment)} fill={`url(#${uid}-cost)`} />
                  <path d={smoothPath(segment)} fill="none" stroke={COST_COLOR} strokeWidth="2" strokeLinecap="round" />
                </g>
              ))}

              {hover !== null && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={baseline} stroke="#94a3b8" />
                  {salesPts[hover] && <circle cx={salesPts[hover]!.x} cy={salesPts[hover]!.y} r="4" fill={SALES_COLOR} stroke="#ffffff" strokeWidth="2" />}
                  {costPts[hover] && <circle cx={costPts[hover]!.x} cy={costPts[hover]!.y} r="4" fill={COST_COLOR} stroke="#ffffff" strokeWidth="2" />}
                </g>
              )}
            </svg>

            {hovered && hover !== null && (
              <div
                role="status"
                className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg"
                style={{ left: `${tooltipLeftPct}%`, transform: `translateX(${hover > 7 ? 'calc(-100% - 12px)' : '12px'})` }}
              >
                <p className="font-medium text-slate-900">{MONTHS_LONG[hover]}</p>
                <p className="mt-1 flex items-center justify-between gap-4 text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ backgroundColor: SALES_COLOR }} />
                    Ventas
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">{hovered.sales === null ? '—' : money(hovered.sales, currency)}</span>
                </p>
                {hasCost && (
                  <p className="flex items-center justify-between gap-4 text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ backgroundColor: COST_COLOR }} />
                      Costo neto
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900">{hovered.cost === null ? '—' : money(hovered.cost, currency)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-slate-600">Ver datos en tabla</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Mes
                    </th>
                    <th scope="col" className="py-1 pr-4 text-right font-medium">
                      Ventas
                    </th>
                    {hasCost && (
                      <th scope="col" className="py-1 text-right font-medium">
                        Costo neto
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, i) => (
                    <tr key={MONTHS_LONG[i]} className="border-b border-slate-100">
                      <th scope="row" className="py-1 pr-4 font-normal text-slate-700">
                        {MONTHS_LONG[i]}
                      </th>
                      <td className="py-1 pr-4 text-right tabular-nums text-slate-900">{p.sales === null ? '—' : money(p.sales, currency)}</td>
                      {hasCost && <td className="py-1 text-right tabular-nums text-slate-900">{p.cost === null ? '—' : money(p.cost, currency)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
