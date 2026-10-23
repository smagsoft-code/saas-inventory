'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import {
  IMPORT_MATCH_ACTION_LABELS,
  IMPORT_ROW_STATUSES,
  IMPORT_ROW_STATUS_LABELS,
  headerForField,
  importFieldLabel,
  importRowStatusTone,
  type ImportRowIssue,
  type ImportJobRow,
  type ImportRowStatus,
} from '../../../../lib/types/imports';
import type { Paginated } from '../../../../lib/types/pagination';
import { Alert } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Card, CardBody } from '../../../../components/ui/card';
import { Spinner } from '../../../../components/ui/spinner';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

const PAGE_SIZE = 25;

/**
 * The staged rows for one import (`S-IMP-ROWS`) — `GET /api/v1/imports/:id/rows`
 * (`import.execute`), offset paginated, filterable by a single row `status` (the only real filter
 * the DTO accepts). `errors[]` / `warnings[]` are the backend's own user-facing findings
 * (`{ field, code, message }`) — rendered as plain text, never `dangerouslySetInnerHTML`, and the
 * message is trusted as written for the end user. `rawData` is header-keyed; a compact preview of a
 * few cells is shown, not the whole payload. No stack traces, no worker internals — the DTO does
 * not carry them.
 */
export function ImportRows({
  jobId,
  columnMapping,
}: {
  jobId: string;
  /** `{ <Excel header>: <field> }` — lets each finding name the column of the user's own file. */
  columnMapping?: Record<string, string>;
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ImportRowStatus | ''>('');
  const [result, setResult] = useState<Paginated<ImportJobRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number> = { page, pageSize: PAGE_SIZE };
      if (status) query['status'] = status;
      setResult(await apiFetch<Paginated<ImportJobRow>>(`/api/v1/imports/${jobId}/rows`, { query }));
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [jobId, page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = result?.data ?? [];
  const totalPages = result?.meta.totalPages ?? 1;

  function previewCells(row: ImportJobRow): string {
    return Object.entries(row.rawData)
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v === null || v === undefined ? '—' : String(v)}`)
      .join(' · ');
  }

  /** One finding, written so the user can fix it: which field, which column of *their* Excel, what
   * is wrong, and the value that was received (when the message does not already quote it). */
  function renderIssue(row: ImportJobRow, issue: ImportRowIssue): React.ReactNode {
    const label = importFieldLabel(issue.field);
    const header = headerForField(columnMapping, issue.field);
    const received = header ? row.rawData[header] : undefined;
    const receivedText = received === null || received === undefined ? '' : String(received).trim();
    const showReceived = receivedText !== '' && !issue.message.includes(receivedText);
    return (
      <>
        <span className="font-medium">{label}</span>
        {header && header.toLowerCase() !== label.toLowerCase() && (
          <span className="opacity-80"> (columna «{header}»)</span>
        )}
        : {issue.message}
        {showReceived && <span className="opacity-80"> Valor recibido: «{receivedText}».</span>}
      </>
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Filas</h2>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Estado
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value as ImportRowStatus | '');
              }}
            >
              <option value="">Todos</option>
              {IMPORT_ROW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {IMPORT_ROW_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        {loading && !result ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Cargando filas…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            {status ? `Sin filas ${IMPORT_ROW_STATUS_LABELS[status].toLowerCase()}.` : 'Aún no hay filas registradas.'}
          </p>
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH className="text-right">Fila</TH>
                  <TH>Estado</TH>
                  <TH>Coincidencia</TH>
                  <TH>Datos</TH>
                  <TH>Hallazgos</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.rowNumber}>
                    <TD className="text-right text-slate-500">{row.rowNumber}</TD>
                    <TD>
                      <Badge tone={importRowStatusTone(row.status)}>
                        {IMPORT_ROW_STATUS_LABELS[row.status as ImportRowStatus] ?? row.status}
                      </Badge>
                    </TD>
                    <TD className="text-slate-500">
                      {row.matchAction ? IMPORT_MATCH_ACTION_LABELS[row.matchAction] ?? row.matchAction : '—'}
                    </TD>
                    <TD className="max-w-[22rem] truncate text-xs text-slate-500" title={previewCells(row)}>
                      {previewCells(row)}
                    </TD>
                    <TD className="text-xs">
                      {row.errors.length === 0 && row.warnings.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {row.errors.map((issue, i) => (
                            <li key={`e-${i}`} className="text-red-700">
                              {renderIssue(row, issue)}
                            </li>
                          ))}
                          {row.warnings.map((issue, i) => (
                            <li key={`w-${i}`} className="text-amber-700">
                              {renderIssue(row, issue)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  Página {result?.meta.page} de {totalPages} · {result?.meta.total} filas
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-md border border-slate-300 px-3 py-1 font-medium text-slate-700 disabled:text-slate-300"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-md border border-slate-300 px-3 py-1 font-medium text-slate-700 disabled:text-slate-300"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
