'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../lib/api-client';

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Deliberately generic on failure — the API itself never distinguishes "wrong tenant" from
      // "wrong password" (security.md §6), and the frontend doesn't invent a distinction either.
      await apiFetch('/api/v1/auth/login', { method: 'POST', body: { tenantSlug, email, password } });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
        <p className="text-sm text-slate-500">Enter your workspace, email, and password.</p>
      </div>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Workspace
          <input
            required
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
            autoComplete="organization"
            placeholder="acme-corp"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
            autoComplete="email"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Password
          <input
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="text-sm text-slate-500">
        No account yet?{' '}
        <Link href="/register" className="underline">
          Create your company
        </Link>
      </p>
    </main>
  );
}
