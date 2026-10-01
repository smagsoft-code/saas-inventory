'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../../lib/api/errors';
import { Alert } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';

/**
 * The suspend / activate controls for `S-SA-TENANT-DETAIL` (F17-13). Each maps to exactly one real
 * `@PlatformOnly()`, audited endpoint:
 *  - suspend  → `POST /api/v1/platform/tenants/:id/suspend`
 *  - activate → `POST /api/v1/platform/tenants/:id/activate`
 *
 * The backend re-checks the platform principal and CSRF on every call (`apiFetch` attaches the
 * `platform_csrf_token` double-submit header automatically). A confirm step precedes suspend
 * because 011-A makes it take effect **immediately** for every user of the company. The action is
 * recorded in the platform audit log server-side — the note says so; the UI does not manage it.
 *
 * No token is ever read or stored here; errors go through the shared `httpErrorMessage` (never a
 * raw body or stack).
 */
export function TenantLifecycleActions({
  tenantId,
  tenantName,
  action,
}: {
  tenantId: string;
  tenantName: string;
  action: 'suspend' | 'activate';
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/platform/tenants/${tenantId}/${action}`, { method: 'POST' });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('Tu sesión de plataforma no está autorizada para realizar esta acción.');
      } else if (isApiError(err) && err.status === 404) {
        setError('Esta empresa ya no existe.');
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (action === 'activate') {
    return (
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-slate-500">
          Reactivar restaura el acceso de los usuarios de esta empresa de inmediato. La acción queda
          registrada en el log de auditoría de la plataforma.
        </p>
        <div>
          <Button loading={busy} disabled={busy} onClick={() => void run()}>
            Activar empresa
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-slate-500">
        Suspender bloquea a todos los usuarios de <span className="font-medium">{tenantName}</span> el uso
        de la plataforma, con efecto inmediato (las sesiones existentes dejan de funcionar en la
        siguiente solicitud). La reactivación es instantánea. La acción queda registrada en el log
        de auditoría de la plataforma.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>¿Suspender {tenantName}?</span>
          <Button variant="danger" size="sm" loading={busy} disabled={busy} onClick={() => void run()}>
            Confirmar suspensión
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
            Mantener activa
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
            Suspender empresa
          </Button>
        </div>
      )}
    </div>
  );
}
