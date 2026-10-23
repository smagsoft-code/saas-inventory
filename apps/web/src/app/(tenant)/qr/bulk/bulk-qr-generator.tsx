'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { BulkCreateQrCodesResult, PendingQrVariant } from '../../../../lib/types/qr';
import { Alert } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Input, Select } from '../../../../components/ui/input';
import { Modal } from '../../../../components/ui/modal';
import { Spinner } from '../../../../components/ui/spinner';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

const PENDING_PATH = '/api/v1/qr-codes/pending-variants';
const BULK_PATH = '/api/v1/qr-codes/bulk';
const SEARCH_DEBOUNCE_MS = 350;
/** Page size — also the endpoint's maximum, and the most `POST /qr-codes/bulk` accepts at once. */
const PAGE_SIZE = 100;

type Stage = 'select' | 'confirm' | 'result';

/**
 * Selección → confirmación → generación → resultado, entirely client-side (search re-fetches
 * `pending-variants`; nothing here mutates until "Confirmar"). One request for the whole batch —
 * `POST /qr-codes/bulk` — never a loop of individual `POST /qr-codes` calls from the frontend.
 * Backend re-validates every id regardless of what this list shows (§8/§24) — this UI's own
 * filtering is a convenience, never the actual authority.
 */
export function BulkQrGenerator({
  initialVariants,
  initialTotal,
  categories = [],
}: {
  initialVariants: PendingQrVariant[];
  /** Total pending variants for the unfiltered list — drives the pager. Defaults to what was loaded. */
  initialTotal?: number;
  categories?: Array<{ id: string; name: string }>;
}): React.JSX.Element {
  const [variants, setVariants] = useState(initialVariants);
  const [total, setTotal] = useState(initialTotal ?? initialVariants.length);
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage>('select');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<BulkCreateQrCodesResult | null>(null);
  /** `variantId → "Producto — código"` for what was submitted, so the report names rows, not ids. */
  const [submittedLabels, setSubmittedLabels] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const skipNextDebounce = useRef(true);

  async function fetchVariants(nextQ: string, nextCategoryId: string = categoryId, nextPage: number = 1): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number> = { page: nextPage, pageSize: PAGE_SIZE };
      if (nextQ) query['q'] = nextQ;
      if (nextCategoryId) query['categoryId'] = nextCategoryId;
      const result = await apiFetch<{ data: PendingQrVariant[]; meta?: { total: number } }>(PENDING_PATH, { query });
      const pageData = result.data;
      setVariants(pageData);
      setTotal(result.meta?.total ?? pageData.length);
      setPage(nextPage);
      // Drop any selection that no longer appears in the freshly-loaded list (e.g. someone else
      // just generated it) rather than silently submitting a stale id.
      setSelected((cur) => {
        const stillPresent = new Set(pageData.map((v) => v.variantId));
        return new Set([...cur].filter((id) => stillPresent.has(id)));
      });
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Live search, debounced — same convention as products-filters.tsx (skip the first render so
  // mounting never re-fires it, no react-hooks lint rule in this project).
  useEffect(() => {
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const timer = setTimeout(() => void fetchVariants(q.trim(), categoryId, 1), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, categoryId]);

  function toggle(variantId: string): void {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  const allSelected = variants.length > 0 && variants.every((v) => selected.has(v.variantId));
  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(variants.map((v) => v.variantId)));
  }

  async function confirmGenerate(): Promise<void> {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setSubmittedLabels(new Map(variants.filter((v) => selected.has(v.variantId)).map((v) => [v.variantId, `${v.productName} — ${v.sku}`])));
    try {
      const body = await apiFetch<BulkCreateQrCodesResult>(BULK_PATH, {
        method: 'POST',
        body: { variantIds: [...selected] },
      });
      setResult(body);
      setStage('result');
      setSelected(new Set());
      await fetchVariants(q.trim(), categoryId, 1);
    } catch (err) {
      setError(httpErrorMessage(err));
      setStage('select');
    } finally {
      setGenerating(false);
    }
  }

  function generateMore(): void {
    setResult(null);
    setStage('select');
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {categories.length > 0 && (
          <Select
            aria-label="Categoría"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="w-56"
            disabled={stage === 'confirm'}
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          type="search"
          aria-label="Buscar producto, código o categoría"
          placeholder="Buscar producto, código o categoría"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          className="max-w-md"
          disabled={stage === 'confirm'}
        />
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500" aria-busy="true">
          <Spinner className="h-4 w-4" /> Cargando variantes…
        </p>
      ) : variants.length === 0 ? (
        <EmptyState
          title="No existen variantes pendientes de generación"
          description={
            q || categoryId
              ? 'Ningún resultado para esta búsqueda.'
              : 'Todas las variantes disponibles ya tienen un código QR asignado.'
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={toggleAll} disabled={stage === 'confirm'}>
              {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </Button>
            <p className="text-sm text-slate-500">
              {total} variante{total === 1 ? '' : 's'} sin QR{total > variants.length ? ` (mostrando ${variants.length})` : ''} ·{' '}
              <span className="font-medium text-slate-700">{selected.size} seleccionada{selected.size === 1 ? '' : 's'}</span>
            </p>
          </div>

          <Table>
            <THead>
              <TR>
                <TH className="w-0">
                  <span className="sr-only">Seleccionar</span>
                </TH>
                <TH>Producto</TH>
                <TH>Código</TH>
                <TH>Categoría</TH>
              </TR>
            </THead>
            <TBody>
              {variants.map((variant) => (
                <TR key={variant.variantId}>
                  <TD>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${variant.productName} — ${variant.sku}`}
                      checked={selected.has(variant.variantId)}
                      onChange={() => toggle(variant.variantId)}
                      disabled={stage === 'confirm'}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    />
                  </TD>
                  <TD className="font-medium">{variant.productName}</TD>
                  <TD className="text-slate-700">{variant.sku}</TD>
                  <TD className="text-slate-500">{variant.categoryName ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">
                Página {page} de {Math.ceil(total / PAGE_SIZE)}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={page <= 1 || loading || stage === 'confirm'} onClick={() => void fetchVariants(q.trim(), categoryId, page - 1)}>
                  Anterior
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={page >= Math.ceil(total / PAGE_SIZE) || loading || stage === 'confirm'} onClick={() => void fetchVariants(q.trim(), categoryId, page + 1)}>
                  Siguiente
                </Button>
              </div>
            </div>
          )}

          <div>
            <Button type="button" disabled={selected.size === 0 || stage === 'confirm'} onClick={() => setStage('confirm')}>
              {selected.size > 0 ? `Generar ${selected.size} QR` : 'Generar QR'}
            </Button>
          </div>
        </>
      )}

      <Modal
        open={stage === 'confirm'}
        onClose={() => {
          if (!generating) setStage('select');
        }}
        title="Confirmar generación"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={generating} onClick={() => setStage('select')}>
              Cancelar
            </Button>
            <Button type="button" loading={generating} disabled={generating} onClick={() => void confirmGenerate()}>
              Confirmar
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          Está a punto de generar {selected.size} código{selected.size === 1 ? '' : 's'} QR. Cada variante recibirá un
          código QR único.
        </p>
      </Modal>

      {result && (
        <Modal
          open={stage === 'result'}
          onClose={generateMore}
          title={result.summary.errors > 0 ? 'Generación completada parcialmente' : 'Generación completada'}
          size="lg"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <ButtonLink href="/qr" variant="ghost">
                Ver todos los QR
              </ButtonLink>
              <Button type="button" onClick={generateMore}>
                Generar más
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <Alert tone={result.summary.errors > 0 ? 'warning' : 'success'}>
              <ul className="flex flex-col gap-0.5">
                <li>✓ {result.summary.created} código{result.summary.created === 1 ? '' : 's'} QR generado{result.summary.created === 1 ? '' : 's'}</li>
                <li>⊘ {result.summary.skipped} omitido{result.summary.skipped === 1 ? '' : 's'} (ya tenía{result.summary.skipped === 1 ? '' : 'n'} un código vigente)</li>
                <li>✕ {result.summary.errors} error{result.summary.errors === 1 ? '' : 'es'}</li>
              </ul>
            </Alert>

            {result.results.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Resultado</TH>
                    <TH>Detalle</TH>
                  </TR>
                </THead>
                <TBody>
                  {result.results.map((r) => (
                    <TR key={r.variantId}>
                      <TD className="font-medium">{submittedLabels.get(r.variantId) ?? r.variantId}</TD>
                      <TD>
                        <Badge tone={r.status === 'created' ? 'success' : r.status === 'skipped' ? 'neutral' : 'danger'}>
                          {r.status === 'created' ? 'Generado' : r.status === 'skipped' ? 'Omitido' : 'Error'}
                        </Badge>
                      </TD>
                      <TD className="text-slate-700">{r.status === 'created' ? 'Código QR creado' : (r.reason ?? '—')}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
