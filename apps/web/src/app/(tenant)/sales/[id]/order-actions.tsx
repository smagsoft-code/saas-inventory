'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '../../../../lib/types/sales';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Toast } from '../../../../components/ui/toast';

const AMOUNT_TOLERANCE = 0.005;

export interface ExceptionalLine {
  orderItemId: string;
  sku: string;
  productName: string;
  /** The most recent `price_approvals` row's status for this line (by `requestedAt`) — `undefined`
   * if none was ever filed. Drives everything here: Confirmar/Cancelar (and the payment-method
   * picker) only show once every exceptional line is `approved`; a `pending` line shows a waiting
   * notice; anything else (`undefined`/`rejected`/`cancelled`) can (re)file a request. */
  latestStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled';
  /** The line's current frozen price — prefills the "Editar precio" input. Owner redesign: once a
   * request is `rejected`, resubmitting can propose a different price (any valid price, not
   * necessarily above base) via `newPrice`. Optional — without it, "Editar precio" isn't offered. */
  unitPrice?: number;
  maxPrice?: number;
}

type Action = 'confirm' | 'cancel' | 'request';

/**
 * The order lifecycle controls (`S-ORDER-DETAIL` actions), owner redesign: the payment method is
 * picked right here, immediately before confirming — never at `POST /orders` — and gated on every
 * exceptional-discount line's latest approval being `approved`. Every button still maps to one
 * real endpoint/permission/allowed-state; the backend re-checks all of it (location authorization
 * included) — this never decides on its own whether an approval is actually required.
 *  - Confirm → `POST /orders/:id/confirm { payments }` (`sales.orders.create`, status `pending`,
 *    every exceptional line `approved`; the backend's own `409` is the final word regardless).
 *  - Cancel  → `POST /orders/:id/cancel` (`sales.orders.cancel`, status `pending`).
 *  - Request price approval → `POST /price-approvals { orderItemId, reason }`
 *    (`pricing.discount.request`) for a below-base line, with a fixed `reason` — no form. Owner
 *    redesign: once a request is `rejected`, "Editar precio" resubmits with `newPrice` instead —
 *    any valid price, not necessarily above base (validated server-side the same way a negotiated
 *    price is at checkout).
 */
export function OrderActions({
  orderId,
  status,
  total,
  canConfirm,
  canCancel,
  canRequestApproval,
  exceptionalLines,
  requesterName,
}: {
  orderId: string;
  status: string;
  /** The order's own frozen total — the default/only payment amount once a single method is
   * selected, and what the split must sum to. */
  total: number;
  canConfirm: boolean;
  canCancel: boolean;
  canRequestApproval: boolean;
  exceptionalLines: ExceptionalLine[];
  /** The caller's own display name (`session.fullName`) — folded into the automatic approval
   * reason ("Descuento solicitado por <nombre>.") instead of a generic "el vendedor" when known. */
  requesterName: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const base = `/api/v1/orders/${orderId}`;
  // Sent automatically — the owner dropped the "motivo" field from the UI (it never adds value
  // for a seller just clicking a button); the column stays `NOT NULL` for the historical record,
  // it's just no longer something the seller types.
  const approvalReason = `Descuento solicitado por ${requesterName || 'el vendedor'}.`;

  const isPending = status === 'pending';
  const needsApproval = exceptionalLines.length > 0 && !exceptionalLines.every((line) => line.latestStatus === 'approved');
  const showConfirm = isPending && canConfirm && !needsApproval;
  const showCancel = isPending && canCancel && !needsApproval;
  const showRequest = isPending && needsApproval && canRequestApproval;
  const showPermissionNotice = isPending && needsApproval && !canRequestApproval;
  const requestable = exceptionalLines.filter((line) => line.latestStatus !== 'pending' && line.latestStatus !== 'approved');
  const pendingLines = exceptionalLines.filter((line) => line.latestStatus === 'pending');

  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set());
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editPriceInput, setEditPriceInput] = useState('');

  // --- payment method (owner redesign — asked here, right before confirming) -----------------
  const [selectedMethods, setSelectedMethods] = useState<Set<PaymentMethod>>(() => new Set<PaymentMethod>(['cash']));
  const [amounts, setAmounts] = useState<Partial<Record<PaymentMethod, string>>>(() => ({ cash: total.toFixed(2) }));

  function toggleMethod(method: PaymentMethod): void {
    const wasSingle = selectedMethods.size === 1;
    const next = new Set(selectedMethods);
    if (next.has(method)) {
      if (next.size === 1) {
        return;
      }
      next.delete(method);
    } else {
      next.add(method);
    }
    setSelectedMethods(next);
    if (next.size === 1) {
      const only = [...next][0]!;
      setAmounts({ [only]: total.toFixed(2) });
    } else {
      setAmounts((prev) => {
        const copy: Partial<Record<PaymentMethod, string>> = {};
        for (const m of next) {
          copy[m] = wasSingle ? '' : prev[m] ?? '';
        }
        return copy;
      });
    }
  }

  const paymentsTotal = [...selectedMethods].reduce((sum, m) => sum + (Number(amounts[m]) || 0), 0);
  const paymentsMatch = Math.abs(paymentsTotal - total) < AMOUNT_TOLERANCE && total > 0;

  // `success` keeps the card (and the toast inside it) mounted for its own 3s-then-fade lifetime
  // even once the order has moved past every other reason to render — otherwise a just-confirmed
  // order (no longer pending, so none of the flags above hold) would unmount this before the toast
  // ever gets to show.
  if (!showConfirm && !showCancel && !showRequest && !showPermissionNotice && !success) {
    return null;
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
      if (isApiError(err) && err.status === 403) {
        setError('No tienes autorización para realizar esta acción en este pedido.');
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitRequest(orderItemId: string, newPrice?: number): Promise<void> {
    await run(
      'request',
      () =>
        apiFetch('/api/v1/price-approvals', {
          method: 'POST',
          body: { orderItemId, reason: approvalReason, ...(newPrice !== undefined ? { newPrice } : {}) },
        }),
      () => {
        setJustRequested((prev) => new Set(prev).add(orderItemId));
        setEditingLineId(null);
      },
    );
  }

  async function confirmOrder(): Promise<void> {
    if (!paymentsMatch) {
      return;
    }
    const payments = [...selectedMethods].map((method) => ({ paymentMethod: method, amount: Number(amounts[method]) }));
    await run(
      'confirm',
      () => apiFetch(`${base}/confirm`, { method: 'POST', body: { payments } }),
      () => setSuccess('Pedido Confirmado'),
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-900">Acciones</h2>

        {error && <Alert tone="error">{error}</Alert>}
        {success && <Toast message={success} onDismiss={() => setSuccess(null)} />}

        {(showRequest || showPermissionNotice) && (
          <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">Uno o más productos necesitan Aprobación</p>
            {showPermissionNotice && (
              <p className="text-xs text-amber-700">
                No tienes permiso para solicitar o ver el estado de esa aprobación — pide a un supervisor o
                administrador que la gestione.
              </p>
            )}
            {pendingLines.length > 0 && (
              <p className="text-xs text-amber-700">
                {pendingLines.length === 1 ? 'Una solicitud' : `${pendingLines.length} solicitudes`} ya{' '}
                {pendingLines.length === 1 ? 'está' : 'están'} esperando que un supervisor o administrador la resuelva.
              </p>
            )}
            {showRequest && requestable.length > 0 && (
              <ul className="flex flex-col gap-2">
                {requestable.map((line) => {
                  const sent = justRequested.has(line.orderItemId);
                  return (
                    <li
                      key={line.orderItemId}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="text-sm">
                        <span className="font-medium">{line.sku}</span>
                        <span className="text-slate-600"> · {line.productName}</span>
                        {line.latestStatus === 'rejected' && !sent && <span className="ml-1 text-red-700">(rechazada — solicita de nuevo)</span>}
                      </div>
                      {sent ? (
                        <span className="text-sm font-medium text-amber-700">Solicitud enviada</span>
                      ) : editingLineId === line.orderItemId ? (
                        <div className="flex items-center gap-2">
                          <span className="flex items-center rounded-md border border-slate-300 bg-white pl-1.5">
                            <span className="text-xs text-slate-500">$</span>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              aria-label={`Nuevo precio para ${line.sku}`}
                              value={editPriceInput}
                              onChange={(e) => setEditPriceInput(e.target.value)}
                              className="w-24 border-0 pl-0.5 pr-1 text-sm"
                            />
                          </span>
                          <Button
                            size="sm"
                            loading={busy === 'request'}
                            disabled={busy !== null || !editPriceInput}
                            onClick={() => void submitRequest(line.orderItemId, Number(editPriceInput))}
                          >
                            Enviar con nuevo precio
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditingLineId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            loading={busy === 'request'}
                            disabled={busy !== null}
                            onClick={() => void submitRequest(line.orderItemId)}
                          >
                            Solicitar aprobación
                          </Button>
                          {line.latestStatus === 'rejected' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() => {
                                setEditingLineId(line.orderItemId);
                                setEditPriceInput(line.unitPrice !== undefined ? String(line.unitPrice) : '');
                              }}
                            >
                              Editar precio
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {showConfirm && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Forma de pago</h3>
            <div className="flex flex-wrap gap-4">
              {PAYMENT_METHODS.map((method) => (
                <label key={method} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={selectedMethods.has(method)} onChange={() => toggleMethod(method)} className="h-4 w-4" />
                  {PAYMENT_METHOD_LABELS[method]}
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {PAYMENT_METHODS.filter((m) => selectedMethods.has(m)).map((method) => (
                <div key={method} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-sm text-slate-600">{PAYMENT_METHOD_LABELS[method]}</span>
                  <span className="flex items-center rounded-md border border-slate-300 bg-white pl-1.5">
                    <span className="text-xs text-slate-500">$</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={`Monto en ${PAYMENT_METHOD_LABELS[method]}`}
                      value={amounts[method] ?? ''}
                      disabled={selectedMethods.size === 1}
                      onChange={(e) => setAmounts((prev) => ({ ...prev, [method]: e.target.value }))}
                      className="w-28 border-0 pl-0.5 pr-1 text-sm"
                    />
                  </span>
                </div>
              ))}
            </div>
            {!paymentsMatch && (
              <p className="text-xs text-red-600">
                La suma de los pagos (${paymentsTotal.toFixed(2)}) debe ser igual al total (${total.toFixed(2)}).
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {showConfirm && (
            <Button loading={busy === 'confirm'} disabled={busy !== null || !paymentsMatch} onClick={() => void confirmOrder()}>
              Confirmar pedido
            </Button>
          )}
          {showCancel && !confirmCancel && (
            <Button variant="danger" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
              Cancelar pedido
            </Button>
          )}
        </div>

        {confirmCancel && showCancel && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>¿Cancelar este pedido? Se libera la reserva de stock. Esto no se puede deshacer.</span>
            <Button
              variant="danger"
              size="sm"
              loading={busy === 'cancel'}
              disabled={busy !== null}
              onClick={() => void run('cancel', () => apiFetch(`${base}/cancel`, { method: 'POST' }), () => setConfirmCancel(false))}
            >
              Confirmar cancelación
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmCancel(false)}>
              Mantener pedido
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
