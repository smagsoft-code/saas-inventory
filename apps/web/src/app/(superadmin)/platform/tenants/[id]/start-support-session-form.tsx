'use client';
import { HelpTip } from '../../../../../components/ui/help-tip';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../../lib/api/client';
import { httpErrorMessage } from '../../../../../lib/api/errors';
import { Alert } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import { Field } from '../../../../../components/ui/field';
import type { SupportSession, SupportSessionMode } from '../../../../../lib/types/platform-tenant';

/**
 * ADR-0036 §10 — the "Acceder como soporte" trigger. Starting a session here never issues a tenant
 * session or reuses tenant credentials (§1/§20) — it only creates a `platform_support_sessions` row
 * scoped to this tenant, for the caller's own existing platform identity. `reason` is required for
 * every mode (write demands it structurally per the DTO; read strongly encourages it in copy) so
 * every session has an auditable justification from the moment it starts.
 *
 * On success this redirects straight into the Tenant's own app (`/`, the ordinary tenant home) —
 * TenantGuard now resolves a support session as an alternate, GET-only tenant context (ADR-0036
 * extension), so every ordinary tenant screen (Dashboard, Productos, Inventario, Ventas, …) works
 * normally for READ; the curated `/support` panel remains the one place with an actual write
 * action (the warehouse status toggle). There is no separate "confirm" step beyond this form
 * because starting a session is itself reversible (`[Salir del modo soporte]` on the banner, or
 * natural expiry) and already fully audited (`support_session.started`).
 */
export function StartSupportSessionForm({
  tenantId,
  existingSession,
}: {
  tenantId: string;
  /** A live session already open for the CALLER on this exact tenant — offer to resume it instead
   * of starting a redundant one. A session on a *different* tenant is not passed here; starting a
   * new one simply supersedes it (server-side), which this form does not need to explain. */
  existingSession: SupportSession | null;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SupportSessionMode>('read');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (existingSession) {
    return (
      <div className="flex flex-col gap-2">
        <Alert tone="info">
          Ya tienes una sesión de soporte activa en esta empresa (
          {existingSession.mode === 'write' ? 'Intervención' : 'Solo lectura'}).
        </Alert>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => router.push('/')}>
            Entrar a la empresa
          </Button>
          <Button size="sm" variant="secondary" onClick={() => router.push(`/platform/tenants/${tenantId}/support`)}>
            Panel de soporte (almacenes)
          </Button>
        </div>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch<SupportSession>(`/api/v1/platform/tenants/${tenantId}/support-sessions`, {
        method: 'POST',
        body: { mode, reason },
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Acceder como soporte
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">
          <span className="flex items-center gap-1.5">
            Modo
            <HelpTip>
              Obtienes un contexto temporal y auditado sobre esta empresa. Sigues actuando como
              administrador de plataforma — nunca como un usuario del Tenant.
            </HelpTip>
          </span>
        </legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="supportMode"
            className="mt-1"
            checked={mode === 'read'}
            disabled={busy}
            onChange={() => setMode('read')}
          />
          <span>
            Solo lectura
            <span className="block text-xs text-slate-500">Consultar usuarios y almacenes, sin cambiar nada.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="supportMode"
            className="mt-1"
            checked={mode === 'write'}
            disabled={busy}
            onChange={() => setMode('write')}
          />
          <span>
            Intervención
            <span className="block text-xs text-slate-500">
              Permite además una acción puntual y acotada (p. ej. activar/desactivar un almacén). Cada
              intervención queda registrada en el log de auditoría.
            </span>
          </span>
        </label>
      </fieldset>

      <Field
        label="Motivo"
        required
        help={mode === 'write' ? 'Obligatorio para intervención.' : 'Recomendado — queda en el log de auditoría.'}
      >
        <textarea
          className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={busy}>
          Continuar
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
