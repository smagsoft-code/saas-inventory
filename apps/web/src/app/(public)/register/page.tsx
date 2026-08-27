'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Alert } from '../../../components/ui/alert';

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
      // Server-side DTO validation is the authority — the client `minLength` hints are only fast
      // feedback (frontend.md#state-forms-and-validation).
      await apiFetch('/api/v1/auth/register', {
        method: 'POST',
        body: { companyName, email, password, fullName },
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not create your account. Please try again.',
      );
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
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Company name" required>
          <Input
            name="companyName"
            required
            minLength={2}
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            autoComplete="organization"
          />
        </Field>
        <Field label="Your full name" required>
          <Input
            name="fullName"
            required
            minLength={2}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
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
        <Field label="Password" required hint="Minimum 10 characters.">
          <Input
            name="password"
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" loading={submitting}>
          Create company
        </Button>
      </form>
      <p className="text-sm text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-slate-900 underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
