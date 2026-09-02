'use client';

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

interface ActionItem {
  id: string;
  productVariantId: string;
  quantityRequested: number;
  quantityDispatched: number;
  quantityReceived: number;
}

type Transition = 'approve' | 'prepare' | 'dispatch' | 'receive' | 'cancel';

/** A distinct idempotency key per logical receiving attempt — reused across retries of that same
 * attempt, regenerated only for a fresh one (matches `randomCorrelationId` in the api client). */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-receive-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
 * never a redirect. Every action is single-flight (`busy` guard).
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
  const [confirmCancel, setConfirmCancel] = useState(false);

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

  const outstanding = items.filter((item) => item.quantityDispatched - item.quantityReceived > 0);

  function friendlyError(err: unknown, locationHint: boolean): string {
    if (isApiError(err) && err.status === 403) {
      return locationHint
        ? 'You are not authorized to operate on this transfer’s location.'
        : 'You are not authorized to perform this action.';
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
    try {
      await request();
      opts.onDone?.();
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
      setError('Enter a quantity for at least one line.');
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

  if (!showApprove && !showPrepare && !showDispatch && !showReceive && !showCancel) {
    return null;
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-900">Actions</h2>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          {showApprove && (
            <Button
              loading={busy === 'approve'}
              disabled={busy !== null}
              onClick={() => void run('approve', () => apiFetch(`${base}/approve`, { method: 'POST' }))}
            >
              Approve
            </Button>
          )}
          {showPrepare && (
            <Button
              loading={busy === 'prepare'}
              disabled={busy !== null}
              onClick={() => void run('prepare', () => apiFetch(`${base}/prepare`, { method: 'POST' }), { locationHint: true })}
            >
              Prepare
            </Button>
          )}
          {showDispatch && !dispatchOpen && (
            <Button variant="secondary" disabled={busy !== null} onClick={openDispatch}>
              Dispatch…
            </Button>
          )}
          {showReceive && !receiveOpen && (
            <Button variant="secondary" disabled={busy !== null} onClick={openReceive}>
              Receive…
            </Button>
          )}
          {showCancel && !confirmCancel && (
            <Button variant="danger" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
              Cancel transfer
            </Button>
          )}
        </div>

        {confirmCancel && showCancel && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>Cancel this transfer? Any reservation at the source is released.</span>
            <Button
              variant="danger"
              size="sm"
              loading={busy === 'cancel'}
              disabled={busy !== null}
              onClick={() =>
                void run('cancel', () => apiFetch(`${base}/cancel`, { method: 'POST' }), {
                  onDone: () => setConfirmCancel(false),
                })
              }
            >
              Confirm cancel
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmCancel(false)}>
              Keep transfer
            </Button>
          </div>
        )}

        {showDispatch && dispatchOpen && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Dispatch quantities</p>
            <p className="text-xs text-slate-500">
              Defaults to each line&apos;s requested quantity. Lower a value only if you are short-shipping it.
            </p>
            {items.map((item) => (
              <Field key={item.id} label={`Variant ${item.productVariantId.slice(0, 8)}… (requested ${item.quantityRequested})`}>
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
            <div className="flex gap-2">
              <Button loading={busy === 'dispatch'} disabled={busy !== null} onClick={() => void submitDispatch()}>
                Dispatch
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setDispatchOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {showReceive && receiveOpen && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Receive stock</p>
            {outstanding.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing is outstanding to receive on this transfer.</p>
            ) : (
              outstanding.map((item) => {
                const remaining = item.quantityDispatched - item.quantityReceived;
                return (
                  <div key={item.id} className="flex flex-col gap-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                    <Field label={`Variant ${item.productVariantId.slice(0, 8)}… (up to ${remaining})`}>
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
                      <Field label="Incident" hint="Optional.">
                        <Select
                          value={receiveIncident[item.id] ?? ''}
                          onChange={(e) => setReceiveIncident((cur) => ({ ...cur, [item.id]: e.target.value }))}
                        >
                          <option value="">None</option>
                          {TRANSFER_INCIDENT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {TRANSFER_INCIDENT_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {receiveIncident[item.id] && (
                        <Field label="Incident notes" hint="Optional.">
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
            <Field label="Notes" hint="Optional — recorded on the receiving event.">
              <Textarea maxLength={1000} value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button
                loading={busy === 'receive'}
                disabled={busy !== null || outstanding.length === 0}
                onClick={() => void submitReceive()}
              >
                Confirm receipt
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setReceiveOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
