'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/input';

export interface ExceptionalLine {
  orderItemId: string;
  sku: string;
  productName: string;
  /** true when this line already has a `price_approvals` row (any status) — the request panel
   * hides it; the backend also refuses a duplicate pending request (409). */
  hasApproval: boolean;
}

type Action = 'confirm' | 'cancel' | 'request';

/**
 * The order lifecycle controls (`S-ORDER-DETAIL` actions). Every button maps to one real endpoint,
 * permission and allowed state — the backend re-checks all three plus location authorization:
 *  - Confirm → `POST /orders/:id/confirm` (`sales.orders.create`, status `pending`; `409` while an
 *    exceptional line still needs an approved `price_approvals` row).
 *  - Cancel  → `POST /orders/:id/cancel`  (`sales.orders.cancel`, status `pending`; releases the
 *    reservation. A `confirmed` order can only be reversed by a return.)
 *  - Request price approval → `POST /price-approvals { orderItemId, reason }`
 *    (`pricing.discount.request`) for a below-minimum line, so the order can later be confirmed.
 *
 * The UI never decides whether an approval is required, never writes inventory movements, and never
 * approves — it reacts to what the backend returns and refreshes the server-rendered detail.
 */
export function OrderActions({
  orderId,
  status,
  canConfirm,
  canCancel,
  canRequestApproval,
  exceptionalLines,
}: {
  orderId: string;
  status: string;
  canConfirm: boolean;
  canCancel: boolean;
  canRequestApproval: boolean;
  exceptionalLines: ExceptionalLine[];
}): React.JSX.Element | null {
  const router = useRouter();
  const base = `/api/v1/orders/${orderId}`;

  const isPending = status === 'pending';
  const showConfirm = isPending && canConfirm;
  const showCancel = isPending && canCancel;
  const requestable = exceptionalLines.filter((line) => !line.hasApproval);
  const showRequest = isPending && canRequestApproval && requestable.length > 0;

  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  if (!showConfirm && !showCancel && !showRequest) {
    return null;
  }

  async function run(action: Action, request: () => Promise<unknown>, onDone?: () => void): Promise<void> {
    if (busy) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await request();
      onDone?.();
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('You are not authorized to perform this action on this order.');
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitRequest(orderItemId: string): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Give a reason of at least 3 characters for the exceptional discount.');
      return;
    }
    await run(
      'request',
      () => apiFetch('/api/v1/price-approvals', { method: 'POST', body: { orderItemId, reason: trimmed } }),
      () => {
        setRequestFor(null);
        setReason('');
        setNotice('Price-approval request filed. A supervisor must approve it before the order can be confirmed.');
      },
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-900">Actions</h2>

        {error && <Alert tone="error">{error}</Alert>}
        {notice && (
          <Alert tone="success">
            {notice} <Link href={`/approvals?orderId=${orderId}`} className="underline">View approvals</Link>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {showConfirm && (
            <Button
              loading={busy === 'confirm'}
              disabled={busy !== null}
              onClick={() => void run('confirm', () => apiFetch(`${base}/confirm`, { method: 'POST' }))}
            >
              Confirm order
            </Button>
          )}
          {showCancel && !confirmCancel && (
            <Button variant="danger" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
              Cancel order
            </Button>
          )}
        </div>

        {confirmCancel && showCancel && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>Cancel this order? The stock reservation is released. This cannot be undone.</span>
            <Button
              variant="danger"
              size="sm"
              loading={busy === 'cancel'}
              disabled={busy !== null}
              onClick={() =>
                void run('cancel', () => apiFetch(`${base}/cancel`, { method: 'POST' }), () => setConfirmCancel(false))
              }
            >
              Confirm cancel
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmCancel(false)}>
              Keep order
            </Button>
          </div>
        )}

        {showRequest && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Below-minimum lines need a price approval</p>
            <p className="text-xs text-slate-500">
              File a request for each exceptional line. A user with the approval permission resolves it; the order can
              be confirmed once every such line is approved.
            </p>
            <ul className="flex flex-col gap-3">
              {requestable.map((line) => (
                <li key={line.orderItemId} className="flex flex-col gap-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                  <div className="text-sm">
                    <span className="font-medium">{line.sku}</span>
                    <span className="text-slate-500"> · {line.productName}</span>
                  </div>
                  {requestFor === line.orderItemId ? (
                    <>
                      <Field label="Reason" hint="3–500 characters. Why the exceptional discount is justified.">
                        <Textarea
                          maxLength={500}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          loading={busy === 'request'}
                          disabled={busy !== null}
                          onClick={() => void submitRequest(line.orderItemId)}
                        >
                          Submit request
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => {
                            setRequestFor(null);
                            setReason('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => {
                        setRequestFor(line.orderItemId);
                        setReason('');
                        setError(null);
                      }}
                    >
                      Request approval
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
