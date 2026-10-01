'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../../lib/api/client';
import { httpErrorMessage } from '../../../../../lib/api/errors';
import type { PlatformTenantOnboardingResult } from '../../../../../lib/types/platform-tenant';
import { Alert } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import { Field } from '../../../../../components/ui/field';
import { Input } from '../../../../../components/ui/input';

/** ADR-0036 — `POST /platform/tenants`, no password field (§1/§3 of the block). On success shows the
 * invitation link EXACTLY ONCE (or, if the email already had an active identity, explains that no
 * link was needed) — nothing here ever stores the raw token beyond this render. */
export function CreateTenantForm(): React.JSX.Element {
  const [companyName, setCompanyName] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PlatformTenantOnboardingResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<PlatformTenantOnboardingResult>('/api/v1/platform/tenants', {
        method: 'POST',
        body: { companyName, adminFullName, adminEmail },
      });
      setResult(created);
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!result?.invitationUrl) return;
    try {
      await navigator.clipboard.writeText(result.invitationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API can be unavailable (insecure context, permission denied) — the link stays
      // visible/selectable in the text field either way, so this failure is silent, not blocking.
    }
  }

  if (result) {
    return (
      <div className="flex max-w-lg flex-col gap-4">
        <Alert tone="success" title="Empresa creada">
          <span className="font-medium">{result.tenant.name}</span> — administrador {result.admin.fullName} ({result.admin.email}).
        </Alert>

        {result.identityReused ? (
          <Alert tone="info">
            Este correo ya tenía una cuenta activa en otra empresa — no se generó invitación. El
            administrador puede iniciar sesión de inmediato con su contraseña existente y elegir esta
            empresa al entrar.
          </Alert>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-700">
              Copia este enlace y envíaselo al administrador — <strong>solo se muestra una vez</strong>. Lo
              usa para establecer su propia contraseña.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.invitationUrl} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyLink()}>
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            {result.invitationExpiresAt && (
              <p className="text-xs text-slate-500">Expira el {new Date(result.invitationExpiresAt).toLocaleString('es')}.</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Link href={`/platform/tenants/${result.tenant.id}`} className="text-sm font-medium text-slate-900 underline">
            Ver ficha de la empresa
          </Link>
          <Link href="/platform/tenants" className="text-sm font-medium text-slate-600 underline">
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <Field label="Nombre de la empresa" required>
        <Input required minLength={2} value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
      </Field>
      <Field label="Nombre del administrador" required>
        <Input required minLength={2} value={adminFullName} onChange={(event) => setAdminFullName(event.target.value)} />
      </Field>
      <Field label="Correo del administrador" required hint="Si ya tiene una cuenta en otra empresa, se reutiliza — no se genera una nueva.">
        <Input type="email" required value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={submitting} className="w-fit">
        Crear empresa
      </Button>
    </form>
  );
}
