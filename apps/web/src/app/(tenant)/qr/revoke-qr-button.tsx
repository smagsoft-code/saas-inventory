'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { Button } from '../../../components/ui/button';

/**
 * Revoke a QR code — `PATCH /api/v1/qr-codes/:id` with body `{ status: 'revoked' }`
 * (`catalog.qr.manage`, the only lifecycle transition the `UpdateQrCodeDto` accepts; there is no
 * "reactivate"). Behind a confirm step because a revoked code stops resolving immediately for
 * anyone who scans the printed label. `apiFetch` attaches the CSRF double-submit header; the
 * backend re-checks permission + tenant.
 */
export function RevokeQrButton({ id }: { id: string }): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/qr-codes/${id}`, { method: 'PATCH', body: { status: 'revoked' } });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'No tienes autorización para revocar este código.'
          : httpErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
        Revocar
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <Button variant="danger" size="sm" loading={busy} disabled={busy} onClick={() => void revoke()}>
          Confirmar revocación
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          Mantener
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
