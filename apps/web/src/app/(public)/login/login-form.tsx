'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { safeReturnTo } from '../../../lib/auth/return-to';
import type { AvailableTenant, LoginResponse } from '../../../lib/types/session';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Alert } from '../../../components/ui/alert';
import { Spinner } from '../../../components/ui/spinner';

const REFRESH_PATH = '/api/v1/auth/refresh';
const LOGIN_PATH = '/api/v1/auth/login';
const SELECT_TENANT_PATH = '/api/v1/auth/select-tenant';
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

/** Deliberately generic — the API never says which credential was wrong (security.md §6), and a
 * 5xx body is never echoed. */
function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return 'Could not reach the server. Check your connection and try again.';
    if (err.status === 429) return 'Too many attempts. Please wait a moment and try again.';
    if (err.status >= 500) return 'Something went wrong on our end. Please try again.';
    return err.message || 'Could not sign in. Please try again.';
  }
  return 'Could not sign in. Please try again.';
}

function selectionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return 'Could not reach the server. Check your connection and try again.';
    if (err.status === 401) return 'Your sign-in timed out before you picked a company. Please sign in again.';
    if (err.status === 429) return 'Too many attempts. Please wait a moment and try again.';
    if (err.status >= 500) return 'Something went wrong on our end. Please try again.';
    return err.message || 'Could not open that company. Please sign in again.';
  }
  return 'Could not open that company. Please sign in again.';
}

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<'credentials' | 'select-tenant'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** The backend-authorised picker list. The only tenants this form can ever select. */
  const [availableTenants, setAvailableTenants] = useState<AvailableTenant[]>([]);
  /** Non-null while a `/auth/select-tenant` call is in flight — also the single-selection lock. */
  const [selectingTenantId, setSelectingTenantId] = useState<string | null>(null);
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

  function completeLogin(): void {
    try {
      sessionStorage.removeItem(RESTORE_KEY);
    } catch {
      /* ignore */
    }
    router.replace(returnTo);
    router.refresh();
  }

  async function handleCredentialsSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // 016-C: credentials only. Which company (if the identity has more than one) is chosen
      // *after* this succeeds — never named here.
      const result = await apiFetch<LoginResponse>(LOGIN_PATH, {
        method: 'POST',
        body: { email, password },
      });
      if (result.status === 'authenticated') {
        completeLogin();
        return;
      }
      // More than one active membership: the httpOnly `tenant_selection` cookie is set; show the
      // picker built from the backend's authorised list.
      setAvailableTenants(result.availableTenants);
      setView('select-tenant');
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectTenant(tenantId: string): Promise<void> {
    if (selectingTenantId) {
      return;
    }
    setError(null);
    setSelectingTenantId(tenantId);
    try {
      // Only the id is sent. The selection token travels in the httpOnly cookie the browser
      // attaches automatically — this form never reads, stores, or forwards it.
      await apiFetch(SELECT_TENANT_PATH, { method: 'POST', body: { tenantId } });
      completeLogin();
    } catch (err) {
      setError(selectionErrorMessage(err));
      setSelectingTenantId(null);
    }
  }

  function backToCredentials(): void {
    setView('credentials');
    setError(null);
    setAvailableTenants([]);
    setSelectingTenantId(null);
    setPassword('');
  }

  if (checkingSession) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" />
        Checking your session…
      </div>
    );
  }

  if (view === 'select-tenant') {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Choose a company</h2>
          <p className="text-sm text-slate-500">Pick where you want to work.</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <ul className="flex flex-col gap-2">
          {availableTenants.map((tenant) => {
            const busy = selectingTenantId === tenant.tenantId;
            return (
              <li key={tenant.tenantId}>
                <button
                  type="button"
                  disabled={selectingTenantId !== null}
                  aria-busy={busy || undefined}
                  onClick={() => void handleSelectTenant(tenant.tenantId)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{tenant.name}</span>
                  {busy ? (
                    <Spinner className="h-4 w-4 shrink-0" />
                  ) : (
                    <span aria-hidden className="text-slate-400">
                      →
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="ghost"
          onClick={backToCredentials}
          disabled={selectingTenantId !== null}
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleCredentialsSubmit} noValidate className="flex flex-col gap-4">
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
