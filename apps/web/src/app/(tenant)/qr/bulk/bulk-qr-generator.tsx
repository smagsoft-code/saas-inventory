'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { BulkCreateQrCodesResult, PendingQrVariant } from '../../../../lib/types/qr';
import { Alert } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Input } from '../../../../components/ui/input';
import { Spinner } from '../../../../components/ui/spinner';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

const PENDING_PATH = '/api/v1/qr-codes/pending-variants';
const BULK_PATH = '/api/v1/qr-codes/bulk';
const SEARCH_DEBOUNCE_MS = 350;

type Stage = 'select' | 'confirm' | 'result';

/**
 * Selección → confirmación → generación → resultado, entirely client-side (search re-fetches
 * `pending-variants`; nothing here mutates until "Confirmar"). One request for the whole batch —
 * `POST /qr-codes/bulk` — never a loop of individual `POST /qr-codes` calls from the frontend.
 * Backend re-validates every id regardless of what this list shows (§8/§24) — this UI's own
 * filtering is a convenience, never the actual authority.
 */
export function BulkQrGenerator({ initialVariants }: { initialVariants: PendingQrVariant[] }): React.JSX.Element {
  const [variants, setVariants] = useState(initialVariants);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage>('select');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<BulkCreateQrCodesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skipNextDebounce = useRef(true);

  async function fetchVariants(nextQ: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const page = await apiFetch<{ data: PendingQrVariant[] }>(PENDING_PATH, {
        query: nextQ ? { q: nextQ } : {},
      });
      setVariants(page.data);
      // Drop any selection that no longer appears in the freshly-loaded list (e.g. someone else
      // just generated it) rather than silently submitting a stale id.
      setSelected((cur) => {
        const stillPresent = new Set(page.data.map((v) => v.variantId));
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
    const timer = setTimeout(() => void fetchVariants(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

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
    try {
      const body = await apiFetch<BulkCreateQrCodesResult>(BULK_PATH, {
        method: 'POST',
        body: { variantIds: [...selected] },
      });
      setResult(body);
      setStage('result');
      setSelected(new Set());
      await fetchVariants(q.trim());
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

  if (stage === 'result' && result) {
    const problems = result.results.filter((r) => r.status !== 'created');
    return (
      <div className="flex flex-col gap-4">
        <Alert tone={result.summary.errors > 0 ? 'warning' : 'success'} title={result.summary.errors > 0 ? 'Generación completada parcialmente' : 'Generación completada'}>
          <ul className="flex flex-col gap-0.5">
            <li>✓ {result.summary.created} código{result.summary.created === 1 ? '' : 's'} QR generado{result.summary.created === 1 ? '' : 's'}</li>
            <li>⊘ {result.summary.skipped} omitido{result.summary.skipped === 1 ? '' : 's'} (ya tenía{result.summary.skipped === 1 ? '' : 'n'} un código vigente)</li>
            <li>✕ {result.summary.errors} error{result.summary.errors === 1 ? '' : 'es'}</li>
          </ul>
        </Alert>

        {problems.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Variante</TH>
                <TH>Resultado</TH>
                <TH>Motivo</TH>
              </TR>
            </THead>
            <TBody>
              {problems.map((r) => (
                <TR key={r.variantId}>
                  <TD className="text-slate-500">{r.variantId}</TD>
                  <TD>
                    <Badge tone={r.status === 'skipped' ? 'neutral' : 'danger'}>
                      {r.status === 'skipped' ? 'Omitido' : 'Error'}
                    </Badge>
                  </TD>
                  <TD className="text-slate-700">{r.reason ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <div className="flex gap-2">
          <Button type="button" onClick={generateMore}>
            Generar más
          </Button>
          <ButtonLink href="/qr" variant="ghost">
            Ver todos los QR
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Input
        type="search"
        aria-label="Buscar producto, variante o SKU"
        placeholder="Buscar producto, variante o SKU"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        className="max-w-md"
        disabled={stage === 'confirm'}
      />

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500" aria-busy="true">
          <Spinner className="h-4 w-4" /> Cargando variantes…
        </p>
      ) : variants.length === 0 ? (
        <EmptyState
          title="No existen variantes pendientes de generación"
          description={
            q
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
              {variants.length} variante{variants.length === 1 ? '' : 's'} disponible{variants.length === 1 ? '' : 's'} ·{' '}
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
                <TH>SKU</TH>
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
                </TR>
              ))}
            </TBody>
          </Table>

          {stage === 'confirm' ? (
            <Alert tone="info" title="Confirmar generación">
              <p className="mb-3">
                Está a punto de generar {selected.size} código{selected.size === 1 ? '' : 's'} QR. Cada variante
                recibirá un código QR único.
              </p>
              <div className="flex gap-2">
                <Button type="button" loading={generating} disabled={generating} onClick={() => void confirmGenerate()}>
                  Confirmar
                </Button>
                <Button type="button" variant="ghost" disabled={generating} onClick={() => setStage('select')}>
                  Cancelar
                </Button>
              </div>
            </Alert>
          ) : (
            <div>
              <Button type="button" disabled={selected.size === 0} onClick={() => setStage('confirm')}>
                {selected.size > 0 ? `Generar ${selected.size} QR` : 'Generar QR'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
