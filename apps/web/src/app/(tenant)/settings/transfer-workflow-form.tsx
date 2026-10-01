'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import type { TenantSettings } from '../../../lib/types/tenant-settings';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';

const SETTINGS_PATH = '/api/v1/administration/tenant-settings';

/**
 * Edits `tenant_settings.transfers_require_*` via `PATCH /administration/tenant-settings`
 * (`administration.settings.manage`) — F17-TRANSFERS-AUDIT §1: not every tenant has staff to fill
 * every stage. Turning a gate off does not remove it from the audit trail or skip its mechanics
 * (reservation, row locking) — it just runs them automatically instead of waiting for a manual
 * "Aprobar"/"Preparar" click (`transfers.service.ts`'s `advanceThroughDisabledStages`).
 * "Despachar"/"Recibir" are never configurable — physical events, not gates.
 */
export function TransferWorkflowForm({
  requireApproval,
  requirePreparation,
  usingDefaults,
  canManage,
}: {
  requireApproval: boolean;
  requirePreparation: boolean;
  usingDefaults: boolean;
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [approval, setApproval] = useState(requireApproval);
  const [preparation, setPreparation] = useState(requirePreparation);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = approval !== requireApproval || preparation !== requirePreparation;

  if (!canManage) {
    return (
      <ul className="flex flex-col gap-1 text-sm">
        <li className="text-slate-900">
          Aprobar transferencias: <span className="font-medium">{requireApproval ? 'Requerida' : 'Automática'}</span>
        </li>
        <li className="text-slate-900">
          Preparar transferencias: <span className="font-medium">{requirePreparation ? 'Requerida' : 'Automática'}</span>
        </li>
        {usingDefaults && <li className="text-xs text-slate-500">Usando el valor predeterminado del sistema.</li>}
        <li className="text-xs text-slate-500">No tienes permiso para cambiar esto.</li>
      </ul>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const updated = await apiFetch<TenantSettings>(SETTINGS_PATH, {
        method: 'PATCH',
        body: { transfersRequireApproval: approval, transfersRequirePreparation: preparation },
      });
      setApproval(updated.transfersRequireApproval);
      setPreparation(updated.transfersRequirePreparation);
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(isApiError(err) && err.status === 403 ? 'Ya no tienes permiso para cambiar esto.' : httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={approval}
            onChange={(e) => {
              setApproval(e.target.checked);
              setSuccess(false);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            Requiere aprobación
            <span className="block text-xs text-slate-500">
              Alguien con el permiso de aprobar debe confirmar cada transferencia antes de prepararla/despacharla. Si se
              desactiva, una transferencia recién creada queda aprobada automáticamente.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={preparation}
            onChange={(e) => {
              setPreparation(e.target.checked);
              setSuccess(false);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            Requiere preparación
            <span className="block text-xs text-slate-500">
              Alguien debe confirmar la preparación (reserva de stock) antes de despachar. Si se desactiva, la reserva se
              hace automáticamente en cuanto la transferencia queda aprobada.
            </span>
          </span>
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Despachar y recibir siempre requieren una acción manual — son el movimiento físico de stock, no un paso previo.
      </p>
      {success && <Alert tone="success">Flujo de transferencias guardado.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
        Guardar flujo de transferencias
      </Button>
    </form>
  );
}
