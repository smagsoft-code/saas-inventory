'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { invitationErrorMessage } from '../../../../lib/auth/auth-errors';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';

/**
 * ADR-0036 — `POST /api/v1/auth/accept-invitation`. The admin sets their OWN password here; the
 * SuperAdmin never sees or chooses it (§1). Success logs the admin in immediately (same session
 * cookies `register()` sets) and lands on the app — no separate login step.
 */
export function AcceptInvitationForm({
  token,
  tenantName,
  email,
}: {
  token: string;
  tenantName: string;
  email: string;
}): React.JSX.Element {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/auth/accept-invitation', {
        method: 'POST',
        body: { token, password },
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(invitationErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Activa tu cuenta</h1>
        <p className="text-sm text-slate-500">
          {tenantName} — {email}. Elige tu propia contraseña para continuar.
        </p>
      </div>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Contraseña" required>
          <Input
            name="password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            autoFocus
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" loading={submitting}>
          Activar cuenta y entrar
        </Button>
      </form>
    </main>
  );
}
