'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  IMPORTS_SUMMARY_GROUP_BY,
  IMPORTS_SUMMARY_GROUP_BY_LABELS,
  type ImportsSummaryGroupBy,
} from '../../../lib/types/imports-reports';
import { IMPORT_JOB_STATUSES, IMPORT_JOB_STATUS_LABELS, type ImportJobStatus } from '../../../lib/types/imports';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface ImportsFilterValues {
  from: string;
  to: string;
  groupBy: ImportsSummaryGroupBy;
  status: string;
}

/**
 * UI/UX QR + Importaciones block, Parte 2/3: the report's own always-visible Fechas/Agrupar por/
 * Estado bar (`ImportsReportFilters`, now removed — the initial report view shows only its KPI
 * cards) and the Historial section's status chip row are consolidated into this single "Filtros"
 * disclosure — same panel pattern `ProductsFilters`/`QrFilters` already establish elsewhere. Zero
 * new capability and zero API contract change: `reportFrom`/`reportTo`/`reportGroupBy`/
 * `reportStatus` still drive the report exactly as `ImportsReportFilters` did ([from, to) at
 * "Hasta", the same "Solo trabajos completados" semantics), and `status` still drives the Historial
 * job list exactly as its old chip row did. The one deliberate change: "Estado" is a single control
 * now — picking it sets `status` and `reportStatus` together, since they are literally the same
 * enum (`IMPORT_JOB_STATUSES`) and showing two separate "Estado" selects would be confusing; this
 * does not add a new filter dimension, it only stops asking for the same one twice.
 */
export function ImportsFilters({ initial }: { initial: ImportsFilterValues }): React.JSX.Element {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));
  const [groupBy, setGroupBy] = useState<ImportsSummaryGroupBy>(initial.groupBy);
  const [status, setStatus] = useState(initial.status);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [panelOpen]);

  /** [from, to) is exclusive at `to` — the picked "to" calendar date must map to the *start of the
   * next* UTC day, same reasoning `ImportsReportFilters` documented. */
  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: { from?: string; to?: string; groupBy?: ImportsSummaryGroupBy; status?: string }): void {
    const params = new URLSearchParams();
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextGroupBy = next.groupBy ?? groupBy;
    const nextStatus = next.status ?? status;
    if (nextFrom) params.set('reportFrom', `${nextFrom}T00:00:00.000Z`);
    if (nextTo) params.set('reportTo', nextDayStart(nextTo));
    params.set('reportGroupBy', nextGroupBy);
    if (nextStatus) {
      params.set('reportStatus', nextStatus);
      params.set('status', nextStatus);
    }
    router.push(`/imports?${params.toString()}#report`);
  }

  function clearFilters(): void {
    setGroupBy('day');
    setStatus('');
    router.push('/imports#report');
  }

  const hasFilter = Boolean(status) || groupBy !== 'day';

  return (
    <div ref={panelRef} className="relative">
      <Button type="button" variant={hasFilter ? 'primary' : 'secondary'} onClick={() => setPanelOpen((v) => !v)}>
        Filtros{hasFilter ? ' (activos)' : ''}
      </Button>

      {panelOpen && (
        <div className="absolute right-0 z-10 mt-2 flex w-80 flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-lg">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde" help="Inicio de día en la zona horaria del tenant">
              <Input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  setFrom(e.target.value);
                  apply({ from: e.target.value });
                }}
              />
            </Field>
            <Field label="Hasta" help="Exclusivo — sin incluir">
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setTo(e.target.value);
                  apply({ to: e.target.value });
                }}
              />
            </Field>
          </div>

          <Field label="Agrupar por">
            <Select
              value={groupBy}
              onChange={(e) => {
                const next = e.target.value as ImportsSummaryGroupBy;
                setGroupBy(next);
                apply({ groupBy: next });
              }}
            >
              {IMPORTS_SUMMARY_GROUP_BY.map((g) => (
                <option key={g} value={g}>
                  {IMPORTS_SUMMARY_GROUP_BY_LABELS[g]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Estado" help="Filtra el reporte y el historial">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                apply({ status: e.target.value });
              }}
            >
              <option value="">Todos los estados</option>
              {IMPORT_JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {IMPORT_JOB_STATUS_LABELS[s as ImportJobStatus] ?? s}
                </option>
              ))}
            </Select>
          </Field>

          {hasFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-start text-xs font-medium text-slate-500 hover:underline"
            >
              Quitar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
