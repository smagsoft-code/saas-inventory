'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../lib/api-client';

interface RegisterResponse {
  user: { tenantSlug: string };
}

export default function RegisterPage(): React.JSX.Element {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Server-side validation (DTOs) is the actual authority — this client-side minlength is
      // only fast feedback, per frontend.md#state-forms-and-validation.
      await apiFetch<RegisterResponse>('/api/v1/auth/register', {
        method: 'POST',
        body: { companyName, email, password, fullName },
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Create your company</h1>
        <p className="text-sm text-slate-500">You&apos;ll become the workspace administrator.</p>
      </div>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Company name
          <input
            required
            minLength={2}
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
            autoComplete="organization"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Your full name
          <input
            required
            minLength={2}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
            autoComplete="name"
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
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
            autoComplete="new-password"
          />
          <span className="text-xs text-slate-400">Minimum 10 characters.</span>
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
          {submitting ? 'Creating…' : 'Create company'}
        </button>
      </form>
      <p className="text-sm text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
