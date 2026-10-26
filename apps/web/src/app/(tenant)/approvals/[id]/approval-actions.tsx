'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';

type Decision = 'approve' | 'reject';

/**
 * Resolve an exceptional-discount request (`S-APPROVAL-DETAIL` actions):
 *  - Approve → `POST /api/v1/price-approvals/:id/approve` (`pricing.discount.approve`)
 *  - Reject  → `POST /api/v1/price-approvals/:id/reject`  (`pricing.discount.approve`)
 *
 * Both are conditional on the request still being `pending`; any holder of
 * `pricing.discount.approve` may resolve a request, their own included (ADR-0022 amendment,
 * 2026-10-26). The UI never changes the order status directly — the backend does, when the order is later confirmed.
 *
 * Owner redesign: approving may also edit the requested price — editing IS approving with that new
 * price, a single action (`{ price }` in the `/approve` body). Omitted, it behaves exactly as
 * before (no body). Reject never takes a price — there's nothing to edit on a request being turned
 * down. `requestedPrice`/`maxPriceAtRequest` are needed to prefill/bound the edit field; when a
 * caller doesn't have them (shouldn't happen from the real page, only in tests), the "Editar
 * precio" affordance is simply not offered.
 */
export function ApprovalActions({
  approvalId,
  status,
  canResolve,
  requestedPrice,
  maxPriceAtRequest,
  minPriceAtRequest,
}: {
  approvalId: string;
  status: string;
  canResolve: boolean;
  requestedPrice?: number | undefined;
  maxPriceAtRequest?: number | undefined;
  minPriceAtRequest?: number | undefined;
}): React.JSX.Element | null {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(requestedPrice !== undefined ? requestedPrice.toFixed(2) : '');

  if (status !== 'pending') {
    return null;
  }
  if (!canResolve) {
    return null;
  }

  function closeConfirm(): void {
    setConfirming(null);
    setEditingPrice(false);
    setPriceInput(requestedPrice !== undefined ? requestedPrice.toFixed(2) : '');
  }

  async function decide(decision: Decision): Promise<void> {
    if (busy) return;
    setBusy(decision);
    setError(null);
    try {
      const editedPrice = decision === 'approve' && editingPrice ? Number(priceInput) : undefined;
      await apiFetch(
        `/api/v1/price-approvals/${approvalId}/${decision}`,
        editedPrice !== undefined && Number.isFinite(editedPrice)
          ? { method: 'POST', body: { price: editedPrice } }
          : { method: 'POST' },
      );
      closeConfirm();
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('No tienes autorización para resolver esta solicitud.');
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}

      {confirming === null ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => setConfirming('approve')}>
            Aprobar
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => setConfirming('reject')}>
            Rechazar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span>
            {confirming === 'approve'
              ? '¿Aprobar este descuento excepcional? El pedido podrá confirmarse después.'
              : '¿Rechazar esta solicitud? El pedido no podrá confirmarse a este precio.'}
          </span>

          {confirming === 'approve' && requestedPrice !== undefined && maxPriceAtRequest !== undefined && (
            <div className="flex flex-wrap items-center gap-2">
              {!editingPrice ? (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditingPrice(true)}>
                  Editar precio
                </Button>
              ) : (
                <>
                  <label className="flex items-center gap-2">
                    <span>Nuevo precio:</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                      value={priceInput}
                      disabled={busy !== null}
                      onChange={(event) => setPriceInput(event.target.value)}
                    />
                  </label>
                  <span className="text-xs text-slate-500">
                    Máx. {maxPriceAtRequest.toFixed(2)}
                    {minPriceAtRequest !== undefined ? ` · Mín. ${minPriceAtRequest.toFixed(2)}` : ''}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      setEditingPrice(false);
                      setPriceInput(requestedPrice.toFixed(2));
                    }}
                  >
                    Quitar edición
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={confirming === 'approve' ? 'primary' : 'danger'}
              loading={busy === confirming}
              disabled={busy !== null}
              onClick={() => void decide(confirming)}
            >
              {confirming === 'approve' ? 'Confirmar aprobación' : 'Confirmar rechazo'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={closeConfirm}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
