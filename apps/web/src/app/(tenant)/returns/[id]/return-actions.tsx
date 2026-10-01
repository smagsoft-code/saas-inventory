'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import {
  DISPOSITIONS,
  DISPOSITION_LABELS,
  returnActionsForStatus,
  type Disposition,
} from '../../../../lib/types/sales';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';

export interface ActionLine {
  returnItemId: string;
  label: string;
  quantityReturned: number;
  inspected: boolean;
  disposition?: Disposition;
  dispositionLocationId?: string;
}
interface LocationOption {
  id: string;
  name: string;
}

type Action = 'inspect' | 'resolve' | 'cancel';

/** A distinct idempotency key per logical resolve attempt — reused across retries of that same
 * attempt, regenerated for a fresh one. */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-return-resolve-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface InspectRow {
  disposition: Disposition;
  dispositionLocationId: string;
  notes: string;
}

/**
 * The return lifecycle controls (`S-RET-DETAIL` actions). Each maps to one real endpoint +
 * permission + allowed state (`ReturnsService`, ADR-0021) — the backend re-checks state, permission
 * and location authorization on every call:
 *  - Inspect → `POST /sales-returns/:id/inspect` (`inventory.returns.manage`, status
 *    `requested`/`inspecting`). `restock` → a sellable location; `quarantine`/`damaged`/`scrap` →
 *    a non-sellable one (server-enforced).
 *  - Resolve → `POST /sales-returns/:id/resolve` (`inventory.returns.manage`, status `inspecting`,
 *    every line inspected; **`Idempotency-Key` required**). Writes one `RETURN` inventory movement
 *    per line — irreversible.
 *  - Cancel  → `POST /sales-returns/:id/cancel` (`sales.returns.create`, status
 *    `requested`/`inspecting`). No inventory effect.
 *
 * The UI never computes stock, never writes a movement, never decides a disposition is valid — it
 * submits the choice and reflects what the backend returns.
 */
export function ReturnActions({
  returnId,
  status,
  lines,
  allInspected,
  sellableLocations,
  nonSellableLocations,
  canManage,
  canCancel,
}: {
  returnId: string;
  status: string;
  lines: ActionLine[];
  allInspected: boolean;
  sellableLocations: LocationOption[];
  nonSellableLocations: LocationOption[];
  canManage: boolean;
  canCancel: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const base = `/api/v1/sales-returns/${returnId}`;
  const allowed = returnActionsForStatus(status);

  const showInspect = allowed.inspect && canManage;
  const showResolve = allowed.resolve && canManage;
  const showCancel = allowed.cancel && canCancel;

  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [resolveKey, setResolveKey] = useState('');
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectRows, setInspectRows] = useState<Record<string, InspectRow>>({});

  if (!showInspect && !showResolve && !showCancel) {
    return null;
  }

  function friendlyError(err: unknown): string {
    if (isApiError(err) && err.status === 403) {
      return 'No tienes autorización para operar sobre el almacén de esta devolución.';
    }
    return httpErrorMessage(err);
  }

  async function run(action: Action, request: () => Promise<unknown>, onDone?: () => void): Promise<void> {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      await request();
      onDone?.();
      router.refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  function firstLocationFor(disposition: Disposition): string {
    const pool = disposition === 'restock' ? sellableLocations : nonSellableLocations;
    return pool[0]?.id ?? '';
  }

  function openInspect(): void {
    const rows: Record<string, InspectRow> = {};
    for (const line of lines) {
      const disposition = line.disposition ?? 'restock';
      rows[line.returnItemId] = {
        disposition,
        dispositionLocationId: line.dispositionLocationId ?? firstLocationFor(disposition),
        notes: '',
      };
    }
    setInspectRows(rows);
    setError(null);
    setInspectOpen(true);
  }

  function setRow(returnItemId: string, patch: Partial<InspectRow>): void {
    setInspectRows((cur) => {
      const row = cur[returnItemId]!;
      const next = { ...row, ...patch };
      // Keep the location pool consistent when the disposition class changes.
      if (patch.disposition && patch.disposition !== row.disposition) {
        const wasRestock = row.disposition === 'restock';
        const isRestock = patch.disposition === 'restock';
        if (wasRestock !== isRestock) {
          next.dispositionLocationId = firstLocationFor(patch.disposition);
        }
      }
      return { ...cur, [returnItemId]: next };
    });
  }

  async function submitInspect(): Promise<void> {
    const items = lines.map((line) => {
      const row = inspectRows[line.returnItemId]!;
      return {
        returnItemId: line.returnItemId,
        disposition: row.disposition,
        dispositionLocationId: row.dispositionLocationId,
        ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
      };
    });
    if (items.some((item) => !item.dispositionLocationId)) {
      setError('Elige un almacén de disposición para cada línea.');
      return;
    }
    await run('inspect', () => apiFetch(`${base}/inspect`, { method: 'POST', body: { items } }), () =>
      setInspectOpen(false),
    );
  }

  async function submitResolve(): Promise<void> {
    const key = resolveKey || newIdempotencyKey();
    if (!resolveKey) {
      setResolveKey(key);
    }
    await run(
      'resolve',
      () => apiFetch(`${base}/resolve`, { method: 'POST', headers: { 'Idempotency-Key': key } }),
      () => setConfirmResolve(false),
    );
  }

  const dispositionPool = (disposition: Disposition): LocationOption[] =>
    disposition === 'restock' ? sellableLocations : nonSellableLocations;

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-900">Acciones</h2>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          {showInspect && !inspectOpen && (
            <Button variant="secondary" disabled={busy !== null} onClick={openInspect}>
              {status === 'requested' ? 'Inspeccionar…' : 'Reinspeccionar…'}
            </Button>
          )}
          {showResolve && !confirmResolve && (
            <Button disabled={busy !== null || !allInspected} onClick={() => setConfirmResolve(true)}>
              Resolver devolución
            </Button>
          )}
          {showCancel && !confirmCancel && (
            <Button variant="danger" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
              Cancelar devolución
            </Button>
          )}
        </div>

        {showResolve && !allInspected && !inspectOpen && (
          <p className="text-xs text-slate-500">Cada línea debe inspeccionarse antes de que la devolución pueda resolverse.</p>
        )}

        {confirmResolve && showResolve && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span>
              ¿Resolver esta devolución? Se registra un movimiento de inventario por línea en su almacén de
              disposición. Esto no se puede deshacer.
            </span>
            <Button loading={busy === 'resolve'} disabled={busy !== null} size="sm" onClick={() => void submitResolve()}>
              Confirmar resolución
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmResolve(false)}>
              Cancelar
            </Button>
          </div>
        )}

        {confirmCancel && showCancel && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>¿Cancelar esta devolución? Libera la cantidad devuelta de vuelta al pedido. Esto no se puede deshacer.</span>
            <Button
              variant="danger"
              size="sm"
              loading={busy === 'cancel'}
              disabled={busy !== null}
              onClick={() =>
                void run('cancel', () => apiFetch(`${base}/cancel`, { method: 'POST' }), () => setConfirmCancel(false))
              }
            >
              Confirmar cancelación
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmCancel(false)}>
              Mantener devolución
            </Button>
          </div>
        )}

        {showInspect && inspectOpen && (
          <div className="flex flex-col gap-4 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Disposición por línea</p>
            <p className="text-xs text-slate-500">
              Reingreso a stock reingresa en un almacén vendible; cuarentena, dañado y desecho reingresan en un
              almacén no vendible.
            </p>
            {lines.map((line) => {
              const row = inspectRows[line.returnItemId]!;
              const pool = dispositionPool(row.disposition);
              return (
                <div
                  key={line.returnItemId}
                  className="flex flex-col gap-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="text-sm">
                    <span className="font-medium">{line.label}</span>
                    <span className="text-slate-500"> · cant. {line.quantityReturned}</span>
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Disposición">
                      <Select
                        value={row.disposition}
                        onChange={(e) => setRow(line.returnItemId, { disposition: e.target.value as Disposition })}
                      >
                        {DISPOSITIONS.map((d) => (
                          <option key={d} value={d}>
                            {DISPOSITION_LABELS[d]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Almacén de disposición"
                      {...(pool.length === 0
                        ? { error: `No hay ningún almacén ${row.disposition === 'restock' ? 'vendible' : 'no vendible'} activo` }
                        : {})}
                    >
                      <Select
                        value={row.dispositionLocationId}
                        disabled={pool.length === 0}
                        onChange={(e) => setRow(line.returnItemId, { dispositionLocationId: e.target.value })}
                      >
                        <option value="">Elige…</option>
                        {pool.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Notas" hint="Opcional.">
                    <Input
                      maxLength={500}
                      value={row.notes}
                      onChange={(e) => setRow(line.returnItemId, { notes: e.target.value })}
                    />
                  </Field>
                </div>
              );
            })}
            <div className="flex gap-2">
              <Button loading={busy === 'inspect'} disabled={busy !== null} onClick={() => void submitInspect()}>
                Guardar inspección
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setInspectOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
