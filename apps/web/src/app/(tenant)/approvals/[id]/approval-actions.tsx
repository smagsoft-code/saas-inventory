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
 * Both are conditional on the request still being `pending`; the **requester can never resolve
 * their own request** (`403`, server-enforced — the UI also hides the buttons as a courtesy). The
 * endpoints take no body. The UI never changes the order status directly — the backend does, when
 * the order is later confirmed.
 */
export function ApprovalActions({
  approvalId,
  status,
  canResolve,
  isOwnRequest,
}: {
  approvalId: string;
  status: string;
  canResolve: boolean;
  isOwnRequest: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'pending') {
    return null;
  }
  if (!canResolve) {
    return null;
  }
  if (isOwnRequest) {
    return (
      <Alert tone="info">You filed this request — another user with the approval permission must resolve it.</Alert>
    );
  }

  async function decide(decision: Decision): Promise<void> {
    if (busy) return;
    setBusy(decision);
    setError(null);
    try {
      await apiFetch(`/api/v1/price-approvals/${approvalId}/${decision}`, { method: 'POST' });
      setConfirming(null);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('You are not authorized to resolve this request.');
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
            Approve
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => setConfirming('reject')}>
            Reject
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span>
            {confirming === 'approve'
              ? 'Approve this exceptional discount? The order can then be confirmed.'
              : 'Reject this request? The order cannot be confirmed at this price.'}
          </span>
          <Button
            size="sm"
            variant={confirming === 'approve' ? 'primary' : 'danger'}
            loading={busy === confirming}
            disabled={busy !== null}
            onClick={() => void decide(confirming)}
          >
            {confirming === 'approve' ? 'Confirm approve' : 'Confirm reject'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
