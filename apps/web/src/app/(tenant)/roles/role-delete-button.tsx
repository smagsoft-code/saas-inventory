'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';

/** `DELETE /roles/:id` — `core.roles.manage`. Backend rejects (409) while 1+ users still hold the
 * role; that message ("Reassign them first") is shown as-is, same convention `httpErrorMessage`
 * already uses for a 409 (`error.message || fallback`). Same inline-confirm pattern as
 * `order-actions.tsx`'s cancel button. */
export function RoleDeleteButton({ roleId, roleName }: { roleId: string; roleName: string }): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/roles/${roleId}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      // Stay in the confirm view (not back to the plain button) so the error is actually seen.
      setError(httpErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        Eliminar
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-red-700">
        <span>¿Eliminar «{roleName}»?</span>
        <Button variant="danger" size="sm" loading={busy} onClick={() => void handleDelete()}>
          Confirmar
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          Cancelar
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
