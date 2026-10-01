'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../../lib/api/client';
import { httpErrorMessage } from '../../../../../lib/api/errors';
import { Alert } from '../../../../../components/ui/alert';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import {
  INVITATION_STATUS_LABELS,
  invitationStatusTone,
  type AdminInvitationStatus,
} from '../../../../../lib/types/platform-tenant';

/**
 * ADR-0036 — the invitation lifecycle for a tenant's founding admin. `invitation === null` means
 * the admin's email already resolved to an active global identity at creation time — no invitation
 * was ever issued (`identityReused`), which is a normal, final state, not a missing one.
 *
 * There is no endpoint to browse the admin's name/email/role outside a live support session
 * (`GAP-SA-TENANT-ADMINS`) — this panel only ever shows invitation lifecycle fields, by design.
 */
export function AdminInvitationPanel({
  tenantId,
  invitation,
}: {
  tenantId: string;
  invitation: AdminInvitationStatus | null;
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkResult, setLinkResult] = useState<{ invitationUrl: string; expiresAt: string } | null>(null);

  async function resend(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ invitationUrl: string; expiresAt: string }>(
        `/api/v1/platform/tenants/${tenantId}/admin-invitation/resend`,
        { method: 'POST' },
      );
      setLinkResult(result);
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/platform/tenants/${tenantId}/admin-invitation/revoke`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!invitation) {
    return (
      <Alert tone="info">
        El correo del administrador ya tenía una cuenta activa en otra empresa — nunca se generó una
        invitación. El administrador entra con su contraseña existente.
      </Alert>
    );
  }

  const canResend = invitation.status !== 'accepted';
  const canRevoke = invitation.status === 'pending' || invitation.status === 'sent';

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}

      <dl className="grid max-w-lg grid-cols-[9rem_1fr] gap-y-2 text-sm">
        <div className="contents">
          <dt className="text-slate-500">Estado</dt>
          <dd>
            <Badge tone={invitationStatusTone(invitation.status)}>
              {INVITATION_STATUS_LABELS[invitation.status] ?? invitation.status}
            </Badge>
          </dd>
        </div>
        {invitation.sentAt && (
          <div className="contents">
            <dt className="text-slate-500">Enviada</dt>
            <dd className="text-slate-900">{new Date(invitation.sentAt).toLocaleString('es')}</dd>
          </div>
        )}
        <div className="contents">
          <dt className="text-slate-500">Expira</dt>
          <dd className="text-slate-900">{new Date(invitation.expiresAt).toLocaleString('es')}</dd>
        </div>
        {invitation.acceptedAt && (
          <div className="contents">
            <dt className="text-slate-500">Aceptada</dt>
            <dd className="text-slate-900">{new Date(invitation.acceptedAt).toLocaleString('es')}</dd>
          </div>
        )}
        {invitation.revokedAt && (
          <div className="contents">
            <dt className="text-slate-500">Revocada</dt>
            <dd className="text-slate-900">{new Date(invitation.revokedAt).toLocaleString('es')}</dd>
          </div>
        )}
      </dl>

      {linkResult && (
        <Alert tone="success" title="Nuevo enlace generado — solo se muestra una vez">
          <p className="mt-1 break-all font-mono text-xs">{linkResult.invitationUrl}</p>
        </Alert>
      )}

      {(canResend || canRevoke) && (
        <div className="flex gap-2">
          {canResend && (
            <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => void resend()}>
              Reenviar invitación
            </Button>
          )}
          {canRevoke && (
            <Button variant="danger" size="sm" loading={busy} disabled={busy} onClick={() => void revoke()}>
              Revocar invitación
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
