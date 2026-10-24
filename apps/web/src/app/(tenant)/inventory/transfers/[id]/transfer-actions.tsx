'use client';
import { HelpTip } from '../../../../../components/ui/help-tip';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../../lib/api/errors';
import {
  TRANSFER_INCIDENT_TYPES,
  TRANSFER_INCIDENT_TYPE_LABELS,
  transferActionsForStatus,
  type TransferIncidentType,
} from '../../../../../lib/types/inventory';
import { Alert } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import { Card, CardBody } from '../../../../../components/ui/card';
import { Field } from '../../../../../components/ui/field';
import { Input, Select, Textarea } from '../../../../../components/ui/input';
import { Modal } from '../../../../../components/ui/modal';
import { Toast } from '../../../../../components/ui/toast';

interface ActionItem {
  id: string;
  productVariantId: string;
  productName?: string;
  sku?: string;
  quantityRequested: number;
  quantityDispatched: number;
  quantityReceived: number;
}

type Transition = 'approve' | 'prepare' | 'dispatch' | 'receive' | 'cancel';

function itemLabel(item: ActionItem): string {
  if (!item.productName) {
    return `Variante ${item.productVariantId.slice(0, 8)}…`;
  }
  return item.sku ? `${item.productName} — ${item.sku}` : item.productName;
}

/** A distinct idempotency key per logical receiving attempt — reused across retries of that same
 * attempt, regenerated only for a fresh one (matches `randomCorrelationId` in the api client). */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-receive-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const SUCCESS_MESSAGE: Record<Transition, string> = {
  approve: 'Transferencia aprobada correctamente.',
  prepare: 'Transferencia preparada correctamente.',
  dispatch: 'Transferencia despachada correctamente.',
  receive: 'Transferencia recibida correctamente.',
  cancel: 'Transferencia cancelada correctamente.',
};

/** The next action a status implies, purely for the "you can't act on this" explanation below —
 * never used to decide whether a button renders (that's still `transferActionsForStatus` +
 * the caller's real permissions). */
const NEXT_ACTION_LABEL: Partial<Record<string, string>> = {
  draft: 'aprobarla',
  approved: 'prepararla',
  preparing: 'despacharla',
  dispatched: 'recibirla',
  partially_received: 'recibirla',
};

/**
 * The transfer lifecycle controls (`S-INV-TRANSFER-DETAIL` actions). Each button maps to one real
 * endpoint + permission + allowed status (ADR-0020):
 *  - Approve  → `POST .../approve`  (`inventory.transfers.approve`, status `draft`)
 *  - Prepare  → `POST .../prepare`  (`inventory.transfers.dispatch`, status `approved`, source loc auth)
 *  - Dispatch → `POST .../dispatch` (`inventory.transfers.dispatch`, status `preparing`, source loc auth)
 *  - Receive  → `POST .../receive`  (`inventory.transfers.receive`, status `dispatched`/`partially_received`,
 *               dest loc auth, `Idempotency-Key` header REQUIRED)
 *  - Cancel   → `POST .../cancel`   (`inventory.transfers.approve`, status `draft`/`approved`/`preparing`)
 *
 * The backend is the authority — a 403 (location authorization) / 409 (state) is shown in place,
 * never a redirect. Every action is single-flight (`busy` guard). When a non-terminal status has NO
 * action visible to the current user, this renders an explanatory note instead of nothing — see
 * `NEXT_ACTION_LABEL` below (F17-TRANSFERS-AUDIT §12: most "el botón Aprobar no funciona" reports
 * turn out to be exactly this — the permission genuinely isn't granted, by design).
 */
export function TransferActions({
  transferId,
  status,
  items,
  canApprove,
  canDispatch,
  canReceive,
}: {
  transferId: string;
  status: string;
  items: ActionItem[];
  canApprove: boolean;
  canDispatch: boolean;
  canReceive: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const base = `/api/v1/inventory/transfers/${transferId}`;

  const allowed = transferActionsForStatus(status);
  const showApprove = allowed.approve && canApprove;
  const showPrepare = allowed.prepare && canDispatch;
  const showDispatch = allowed.dispatch && canDispatch;
  const showReceive = allowed.receive && canReceive;
  const showCancel = allowed.cancel && canApprove;

  const [busy, setBusy] = useState<Transition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'prepare' | 'cancel' | null>(null);

  // Dispatch panel
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchQty, setDispatchQty] = useState<Record<string, string>>({});

  // Receive panel
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveKey, setReceiveKey] = useState('');
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receiveIncident, setReceiveIncident] = useState<Record<string, string>>({});
  const [receiveIncidentNotes, setReceiveIncidentNotes] = useState<Record<string, string>>({});
  const [receiveNotes, setReceiveNotes] = useState('');
  // The general notes box stays collapsed until the user asks for it.
  const [receiveNotesOpen, setReceiveNotesOpen] = useState(false);

  const outstanding = items.filter((item) => item.quantityDispatched - item.quantityReceived > 0);

  function friendlyError(err: unknown, locationHint: boolean): string {
    if (isApiError(err) && err.status === 403) {
      return locationHint
        ? 'No tienes autorización para operar en el almacén de esta transferencia.'
        : 'No tienes autorización para realizar esta acción.';
    }
    return httpErrorMessage(err);
  }

  async function run(
    transition: Transition,
    request: () => Promise<unknown>,
    opts: { locationHint?: boolean; onDone?: () => void } = {},
  ): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(transition);
    setError(null);
    setSuccess(null);
    try {
      await request();
      opts.onDone?.();
      setSuccess(SUCCESS_MESSAGE[transition]);
      router.refresh();
    } catch (err) {
      setError(friendlyError(err, opts.locationHint ?? false));
    } finally {
      setBusy(null);
    }
  }

  function openReceive(): void {
    setReceiveKey(newIdempotencyKey());
    setReceiveQty(Object.fromEntries(outstanding.map((i) => [i.id, String(i.quantityDispatched - i.quantityReceived)])));
    setReceiveIncident({});
    setReceiveIncidentNotes({});
    setReceiveNotes('');
    setReceiveNotesOpen(false);
    setError(null);
    setReceiveOpen(true);
  }

  function openDispatch(): void {
    setDispatchQty(Object.fromEntries(items.map((i) => [i.id, String(i.quantityRequested)])));
    setError(null);
    setDispatchOpen(true);
  }

  async function submitDispatch(): Promise<void> {
    // Only send explicit line overrides when the operator actually short-shipped something;
    // otherwise omit `items` so every line dispatches its full quantityRequested.
    const overrides = items
      .map((item) => ({ transferItemId: item.id, quantityDispatched: Number(dispatchQty[item.id] ?? item.quantityRequested) }))
      .filter((line) => Number.isFinite(line.quantityDispatched));
    const changed = overrides.some((line) => {
      const original = items.find((i) => i.id === line.transferItemId)!;
      return line.quantityDispatched !== original.quantityRequested;
    });
    const body = changed ? { items: overrides } : {};
    await run('dispatch', () => apiFetch(`${base}/dispatch`, { method: 'POST', body }), {
      locationHint: true,
      onDone: () => setDispatchOpen(false),
    });
  }

  async function submitReceive(): Promise<void> {
    const lines = outstanding
      .map((item) => {
        const qty = Number(receiveQty[item.id]);
        if (!Number.isFinite(qty) || qty <= 0) {
          return null;
        }
        const incident = receiveIncident[item.id];
        const incidentNotes = receiveIncidentNotes[item.id]?.trim();
        return {
          transferItemId: item.id,
          quantityReceived: qty,
          ...(incident ? { incidentType: incident as TransferIncidentType } : {}),
          ...(incident && incidentNotes ? { incidentNotes } : {}),
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    if (lines.length === 0) {
      setError('Ingresa una cantidad para al menos un producto.');
      return;
    }

    const body: Record<string, unknown> = { items: lines };
    if (receiveNotes.trim()) {
      body['notes'] = receiveNotes.trim();
    }
    await run(
      'receive',
      () => apiFetch(`${base}/receive`, { method: 'POST', body, headers: { 'Idempotency-Key': receiveKey } }),
      { locationHint: true, onDone: () => setReceiveOpen(false) },
    );
  }

  const noVisibleActions = !showApprove && !showPrepare && !showDispatch && !showReceive && !showCancel;
  const nextActionLabel = NEXT_ACTION_LABEL[status];

  // A status that still has a next step, but none of it is visible to THIS user — surfaces why,
  // instead of silently showing nothing (the actual cause behind "el botón Aprobar no funciona"
  // reports in most cases: the permission genuinely isn't granted, by design — separation of
  // duties, ADR-0009/roles — not a broken button). A truly terminal status (received/cancelled)
  // still renders nothing, same as before.
  if (noVisibleActions && nextActionLabel) {
    return (
      <Card>
        <CardBody>
          <Alert tone="info">
            Esta transferencia está lista para que alguien con el permiso correspondiente pueda{' '}
            {nextActionLabel}. Tu cuenta no tiene ese permiso — pide a un administrador que te lo
            asigne, o que realice esa acción.
          </Alert>
        </CardBody>
      </Card>
    );
  }
  if (noVisibleActions) {
    return null;
  }

  const anyModalOpen = confirmAction !== null || dispatchOpen || receiveOpen;
  const closeConfirm = (): void => {
    if (busy === null) setConfirmAction(null);
  };
  const closeDispatch = (): void => {
    if (busy === null) setDispatchOpen(false);
  };
  const closeReceive = (): void => {
    if (busy === null) setReceiveOpen(false);
  };
  const modalError = error ? <Alert tone="error">{error}</Alert> : null;

  const CONFIRM_COPY: Record<'approve' | 'prepare' | 'cancel', { title: string; text: string; button: string; danger?: boolean }> = {
    approve: { title: 'Aprobar transferencia', text: '¿Aprobar esta transferencia?', button: 'Aprobar' },
    prepare: {
      title: 'Preparar transferencia',
      text: '¿Pasar esta transferencia a preparación? Se reserva el stock en el origen.',
      button: 'Preparar',
    },
    cancel: {
      title: 'Cancelar transferencia',
      text: '¿Cancelar esta transferencia? Se libera cualquier reserva en el origen.',
      button: 'Confirmar cancelación',
      danger: true,
    },
  };

  function submitConfirm(): void {
    if (!confirmAction) return;
    const done = (): void => setConfirmAction(null);
    if (confirmAction === 'approve') {
      void run('approve', () => apiFetch(`${base}/approve`, { method: 'POST' }), { onDone: done });
    } else if (confirmAction === 'prepare') {
      void run('prepare', () => apiFetch(`${base}/prepare`, { method: 'POST' }), { locationHint: true, onDone: done });
    } else {
      void run('cancel', () => apiFetch(`${base}/cancel`, { method: 'POST' }), { onDone: done });
    }
  }

  function openConfirm(action: 'approve' | 'prepare' | 'cancel'): void {
    setError(null);
    setConfirmAction(action);
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-900">Acciones</h2>

        {success && <Toast message={success} onDismiss={() => setSuccess(null)} />}
        {!anyModalOpen && modalError}

        <div className="flex flex-wrap gap-2">
          {showApprove && (
            <Button disabled={busy !== null} onClick={() => openConfirm('approve')}>
              Aprobar
            </Button>
          )}
          {showPrepare && (
            <Button disabled={busy !== null} onClick={() => openConfirm('prepare')}>
              Preparar
            </Button>
          )}
          {showDispatch && (
            <Button variant="secondary" disabled={busy !== null} onClick={openDispatch}>
              Despachar…
            </Button>
          )}
          {showReceive && (
            <Button variant="secondary" disabled={busy !== null} onClick={openReceive}>
              Recibir…
            </Button>
          )}
          {showCancel && (
            <Button variant="danger" disabled={busy !== null} onClick={() => openConfirm('cancel')}>
              Cancelar transferencia
            </Button>
          )}
        </div>

        {confirmAction && (
          <Modal
            open
            onClose={closeConfirm}
            title={CONFIRM_COPY[confirmAction].title}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={busy !== null} onClick={closeConfirm}>
                  {confirmAction === 'cancel' ? 'Mantener transferencia' : 'Cancelar'}
                </Button>
                <Button
                  variant={CONFIRM_COPY[confirmAction].danger ? 'danger' : 'primary'}
                  loading={busy === confirmAction}
                  disabled={busy !== null}
                  onClick={submitConfirm}
                >
                  {CONFIRM_COPY[confirmAction].button}
                </Button>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              {modalError}
              <p className="text-sm text-slate-700">{CONFIRM_COPY[confirmAction].text}</p>
            </div>
          </Modal>
        )}

        {showDispatch && dispatchOpen && (
          <Modal
            open
            onClose={closeDispatch}
            title="Despachar transferencia"
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={busy !== null} onClick={closeDispatch}>
                  Cancelar
                </Button>
                <Button loading={busy === 'dispatch'} disabled={busy !== null} onClick={() => void submitDispatch()}>
                  Despachar
                </Button>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              {modalError}
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                Cantidades a despachar
                <HelpTip>
                  Por defecto es la cantidad solicitada de cada producto. Reduce el valor solo si vas a despachar menos.
                </HelpTip>
              </p>
              {items.map((item) => (
                <Field key={item.id} label={`${itemLabel(item)} (solicitado ${item.quantityRequested})`}>
                  <Input
                    type="number"
                    min={0}
                    max={item.quantityRequested}
                    step="any"
                    value={dispatchQty[item.id] ?? ''}
                    onChange={(e) => setDispatchQty((cur) => ({ ...cur, [item.id]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
          </Modal>
        )}

        {showReceive && receiveOpen && (
          <Modal
            open
            onClose={closeReceive}
            title="Recibir existencias"
            size="lg"
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={busy !== null} onClick={closeReceive}>
                  Cancelar
                </Button>
                <Button
                  loading={busy === 'receive'}
                  disabled={busy !== null || outstanding.length === 0}
                  onClick={() => void submitReceive()}
                >
                  Confirmar recepción
                </Button>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              {modalError}
              {outstanding.length === 0 ? (
                <p className="text-sm text-slate-500">No hay nada pendiente por recibir en esta transferencia.</p>
              ) : (
                outstanding.map((item) => {
                  const remaining = item.quantityDispatched - item.quantityReceived;
                  return (
                    <div key={item.id} className="flex flex-col gap-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                      <Field label={`${itemLabel(item)} (hasta ${remaining})`}>
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          step="any"
                          value={receiveQty[item.id] ?? ''}
                          onChange={(e) => setReceiveQty((cur) => ({ ...cur, [item.id]: e.target.value }))}
                        />
                      </Field>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="Incidencia" help="Opcional.">
                          <Select
                            value={receiveIncident[item.id] ?? ''}
                            onChange={(e) => setReceiveIncident((cur) => ({ ...cur, [item.id]: e.target.value }))}
                          >
                            <option value="">Ninguna</option>
                            {TRANSFER_INCIDENT_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TRANSFER_INCIDENT_TYPE_LABELS[t]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        {receiveIncident[item.id] && (
                          <Field label="Notas de la incidencia" help="Opcional.">
                            <Input
                              maxLength={500}
                              value={receiveIncidentNotes[item.id] ?? ''}
                              onChange={(e) => setReceiveIncidentNotes((cur) => ({ ...cur, [item.id]: e.target.value }))}
                            />
                          </Field>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {receiveNotesOpen || receiveNotes ? (
                <Field label="Notas" help="Opcional — se registra en el evento de recepción.">
                  <Textarea
                    rows={2}
                    maxLength={1000}
                    value={receiveNotes}
                    onChange={(e) => setReceiveNotes(e.target.value)}
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  className="self-start text-sm font-medium text-blue-700 hover:underline"
                  onClick={() => setReceiveNotesOpen(true)}
                >
                  + Agregar notas
                </button>
              )}
            </div>
          </Modal>
        )}
      </CardBody>
    </Card>
  );
}
