'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { safeReturnTo } from '../../../lib/auth/return-to';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Alert } from '../../../components/ui/alert';
import { Spinner } from '../../../components/ui/spinner';

const REFRESH_PATH = '/api/v1/auth/refresh';
const LOGIN_PATH = '/api/v1/auth/login';
/** Loop guard: if the app keeps bouncing here after a "successful" refresh, stop trying. */
const RESTORE_KEY = 'saas:login-restore-attempts';

async function attemptSilentRestore(): Promise<boolean> {
  let attempts = 0;
  try {
    attempts = Number(sessionStorage.getItem(RESTORE_KEY) ?? '0');
  } catch {
    // sessionStorage unavailable — treat as first attempt
  }
  if (attempts >= 2) {
    return false;
  }
  try {
    sessionStorage.setItem(RESTORE_KEY, String(attempts + 1));
  } catch {
    /* ignore */
  }
  try {
    await apiFetch(REFRESH_PATH, { method: 'POST' });
    return true;
  } catch {
    return false;
  }
}

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const [checkingSession, setCheckingSession] = useState(true);
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void (async () => {
      const restored = await attemptSilentRestore();
      if (restored) {
        try {
          sessionStorage.removeItem(RESTORE_KEY);
        } catch {
          /* ignore */
        }
        router.replace(returnTo);
        return;
      }
      setCheckingSession(false);
    })();
  }, [router, returnTo]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Deliberately generic on failure — the API never distinguishes "wrong tenant" from "wrong
      // password" (security.md §6), and the frontend does not invent a distinction.
      await apiFetch(LOGIN_PATH, { method: 'POST', body: { tenantSlug, email, password } });
      try {
        sessionStorage.removeItem(RESTORE_KEY);
      } catch {
        /* ignore */
      }
      router.replace(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" />
        Checking your session…
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Workspace" required>
          <Input
            name="tenantSlug"
            required
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            autoComplete="organization"
            placeholder="acme-corp"
          />
        </Field>
        <Field label="Email" required>
          <Input
            name="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label="Password" required>
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
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-sm text-slate-500">
        No account yet?{' '}
        <Link href="/register" className="font-medium text-slate-900 underline">
          Create your company
        </Link>
      </p>
    </>
  );
}
