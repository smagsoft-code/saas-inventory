'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { loginErrorMessage } from '../../../../lib/auth/auth-errors';
import { safeReturnTo } from '../../../../lib/auth/return-to';
import type { PlatformAuthResponse } from '../../../../lib/types/platform-session';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Alert } from '../../../../components/ui/alert';

const LOGIN_PATH = '/api/v1/platform/auth/login';

export function PlatformLoginForm(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'), '/platform');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Platform login always yields a direct session — platform admins have no memberships and
      // no company selection step.
      await apiFetch<PlatformAuthResponse>(LOGIN_PATH, {
        method: 'POST',
        body: { email, password },
      });
      router.replace(returnTo);
      router.refresh();
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Correo" required>
        <Input
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field label="Contraseña" required>
        <Input
          name="password"
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={submitting}>
        Iniciar sesión
      </Button>
    </form>
  );
}
