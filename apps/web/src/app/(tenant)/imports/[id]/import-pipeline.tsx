'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import {
  STANDARD_TEMPLATE_MAPPING,
  importHasErrorReport,
  importPipelineActions,
  isImportJobProcessing,
  type ImportJob,
  type ImportPreview,
  type MappingTemplate,
} from '../../../../lib/types/imports';
import type { Paginated } from '../../../../lib/types/pagination';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Select } from '../../../../components/ui/input';

type Action = 'mapping' | 'validate' | 'confirm' | 'cancel' | 'refresh';

/** How often the detail refreshes itself while the job is being processed off-request (large files
 * run on the Import Worker). `f17-gaps.md` explicitly blesses polling `GET /imports/:id` for this;
 * there is no progress signal to subscribe to (`GAP-IMPORT-PROGRESS`). */
const POLL_MS = 4000;

const STANDARD_MAPPING_OPTION = '__standard__';

/**
 * The staged import pipeline controls (`S-IMP-DETAIL`). Each action is exactly one real endpoint +
 * the `import.execute` gate, with the transition re-checked server-side (`import-job-state-machine.ts`,
 * `ImportJobService`):
 *  - Apply mapping → `POST /imports/:id/mapping` (`uploaded`/`mapping`/`ready`)
 *  - Validate      → `POST /imports/:id/validate` (`mapping`, or a `failed` job that never validated)
 *  - Import        → `POST /imports/:id/confirm`  (`ready`, or a `failed` job that already validated;
 *                    403 without `import.inventory` when the mode is `update_catalog_and_inventory`)
 *  - Cancel        → `POST /imports/:id/cancel`
 * The UI never advances the job itself, never marks it completed/failed, never computes the final
 * result — it submits the action and reflects `GET /imports/:id` / `GET /imports/:id/preview`.
 */
export function ImportPipeline({
  job: initialJob,
  canUseInventoryMode,
}: {
  job: ImportJob;
  canUseInventoryMode: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const base = `/api/v1/imports/${initialJob.id}`;

  const [job, setJob] = useState<ImportJob>(initialJob);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [templates, setTemplates] = useState<MappingTemplate[] | null>(null);
  const [mappingChoice, setMappingChoice] = useState<string>(STANDARD_MAPPING_OPTION);
  const [includeWarnings, setIncludeWarnings] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => setJob(initialJob), [initialJob]);

  const actions = importPipelineActions(job);
  const wantsPreview = job.status === 'ready' || job.status === 'importing' || job.status === 'validating' || job.status === 'completed_with_errors' || job.status === 'completed';

  const loadPreview = useCallback(async (): Promise<void> => {
    try {
      setPreview(await apiFetch<ImportPreview>(`${base}/preview`));
    } catch {
      /* preview is a nicety — the job card already carries the headline counters */
    }
  }, [base]);

  const refresh = useCallback(async (): Promise<ImportJob | null> => {
    try {
      const next = await apiFetch<ImportJob>(base);
      setJob(next);
      return next;
    } catch (err) {
      setError(httpErrorMessage(err));
      return null;
    }
  }, [base]);

  // Load the preview whenever the job reaches a state that has one.
  useEffect(() => {
    if (wantsPreview) {
      void loadPreview();
    }
  }, [wantsPreview, job.status, loadPreview]);

  // Load saved templates only when a mapping still needs choosing.
  useEffect(() => {
    if (job.status === 'uploaded' && templates === null) {
      apiFetch<Paginated<MappingTemplate>>('/api/v1/import-mapping-templates', { query: { pageSize: 100 } })
        .then((r) => setTemplates(r.data))
        .catch(() => setTemplates([]));
    }
  }, [job.status, templates]);

  // Light polling while the job is processed off-request.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!isImportJobProcessing(job.status)) {
      return;
    }
    pollRef.current = setInterval(() => {
      void (async () => {
        const next = await refresh();
        if (next && !isImportJobProcessing(next.status)) {
          router.refresh();
        }
      })();
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job.status, refresh, router]);

  function friendlyError(err: unknown): string {
    if (isApiError(err) && err.status === 403) {
      return 'No tienes autorización para este paso (importar cantidades de inventario requiere el permiso import-inventory).';
    }
    return httpErrorMessage(err);
  }

  async function run(action: Action, request: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      await request();
      await refresh();
      router.refresh();
      setConfirmOpen(false);
      setCancelOpen(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function applyMapping(): Promise<void> {
    const body =
      mappingChoice === STANDARD_MAPPING_OPTION
        ? { columnMapping: STANDARD_TEMPLATE_MAPPING }
        : { mappingTemplateId: mappingChoice };
    await run('mapping', () => apiFetch(`${base}/mapping`, { method: 'POST', body }));
  }

  const committableRows = (job.validRows ?? preview?.validRows ?? 0) + (job.warningRows ?? preview?.warningRows ?? 0);
  const errorReportHref = `${base}/errors${includeWarnings ? '?includeWarnings=true' : ''}`;
  // The backend rejects confirm for this mode without `import.inventory` (service-side check) — warn
  // before the user tries, but never hide the button (the backend stays the authority).
  const inventoryModeBlocked = job.duplicateHandlingMode === 'update_catalog_and_inventory' && !canUseInventoryMode;

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-900">Proceso</h2>

        {error && <Alert tone="error">{error}</Alert>}

        {/* Counters — real values from the job / preview, never a progress bar or percentage. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Counter label="Filas totales" value={job.totalRows ?? preview?.totalRows} />
          <Counter label="Válidas" value={job.validRows ?? preview?.validRows} />
          <Counter label="Advertencias" value={job.warningRows ?? preview?.warningRows} />
          <Counter label="Inválidas" value={job.invalidRows ?? preview?.invalidRows} />
          {(job.status === 'ready' || wantsPreview) && preview && (
            <>
              <Counter label="Productos nuevos" value={preview.newProducts} />
              <Counter label="Productos existentes" value={preview.existingProducts} />
              <Counter label="Pendientes" value={preview.pendingRows} />
              <Counter label="Importadas" value={job.importedRows ?? preview.importedRows} />
            </>
          )}
        </dl>

        {job.status === 'uploaded' && actions.setMapping && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm text-slate-700">Esta importación todavía necesita un mapeo de columnas.</p>
            <Field label="Mapeo" className="max-w-sm">
              <Select value={mappingChoice} onChange={(e) => setMappingChoice(e.target.value)} disabled={busy !== null}>
                <option value={STANDARD_MAPPING_OPTION}>Diseño de plantilla estándar</option>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button loading={busy === 'mapping'} disabled={busy !== null} onClick={() => void applyMapping()}>
                Aplicar mapeo
              </Button>
            </div>
          </div>
        )}

        {isImportJobProcessing(job.status) && (
          <p className="text-sm text-slate-600" role="status">
            {job.status === 'validating' ? 'Validando filas…' : 'Importando filas…'} Los archivos grandes se procesan en
            segundo plano — esta página se actualiza sola.
          </p>
        )}

        {job.status === 'ready' && (
          <p className="text-sm text-slate-700">
            {committableRows} fila{committableRows === 1 ? '' : 's'} lista{committableRows === 1 ? '' : 's'} para importar
            {(job.invalidRows ?? 0) > 0 ? ` · ${job.invalidRows} fila(s) inválida(s) quedarán fuera` : ''}.
          </p>
        )}

        {job.status === 'failed' && (
          <Alert tone="error">Esta importación falló. Revisa las filas de abajo y reintenta el trabajo pendiente.</Alert>
        )}

        {inventoryModeBlocked && actions.confirm && (
          <Alert tone="warning">
            Esta importación actualiza cantidades de inventario, lo que requiere el permiso import-inventory. Confirmar
            sin él será rechazado.
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {actions.validate && (
            <Button
              loading={busy === 'validate'}
              disabled={busy !== null}
              onClick={() => void run('validate', () => apiFetch(`${base}/validate`, { method: 'POST' }))}
            >
              {job.status === 'failed' ? 'Reintentar validación' : 'Validar filas'}
            </Button>
          )}

          {actions.confirm && !confirmOpen && (
            <Button disabled={busy !== null} onClick={() => setConfirmOpen(true)}>
              {job.status === 'failed' ? 'Reintentar importación' : `Importar ${committableRows} fila${committableRows === 1 ? '' : 's'}`}
            </Button>
          )}

          {actions.cancel && !cancelOpen && (
            <Button variant="danger" disabled={busy !== null} onClick={() => setCancelOpen(true)}>
              Cancelar importación
            </Button>
          )}

          <Button
            variant="ghost"
            loading={busy === 'refresh'}
            disabled={busy !== null}
            onClick={() => void run('refresh', () => refresh())}
          >
            Actualizar
          </Button>
        </div>

        {confirmOpen && actions.confirm && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span>
              ¿Importar ahora {committableRows} fila{committableRows === 1 ? '' : 's'} válida{committableRows === 1 ? '' : 's'}/con
              advertencia? Esto escribe registros de catálogo
              {job.duplicateHandlingMode === 'update_catalog_and_inventory' ? ' e inventario' : ''} por la vía validada
              normal. No se puede deshacer desde aquí.
            </span>
            <Button
              size="sm"
              loading={busy === 'confirm'}
              disabled={busy !== null}
              onClick={() => void run('confirm', () => apiFetch(`${base}/confirm`, { method: 'POST' }))}
            >
              Confirmar importación
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
          </div>
        )}

        {cancelOpen && actions.cancel && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>¿Cancelar esta importación? Nada de lo ya importado se revierte.</span>
            <Button
              size="sm"
              variant="danger"
              loading={busy === 'cancel'}
              disabled={busy !== null}
              onClick={() => void run('cancel', () => apiFetch(`${base}/cancel`, { method: 'POST' }))}
            >
              Confirmar cancelación
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setCancelOpen(false)}>
              Mantener importación
            </Button>
          </div>
        )}

        {importHasErrorReport(job) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm">
            <a
              href={errorReportHref}
              className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
            >
              Descargar reporte de errores (.xlsx)
            </a>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={includeWarnings}
                onChange={(e) => setIncludeWarnings(e.target.checked)}
              />
              incluir filas con advertencia
            </label>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Counter({ label, value }: { label: string; value: number | null | undefined }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900">{value ?? '—'}</dd>
    </div>
  );
}
