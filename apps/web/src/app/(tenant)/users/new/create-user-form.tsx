'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api-client';
import type { Role } from '../../../../lib/core-types';

/** `roles` is only passed in when the caller holds core.roles.assign — §13: assigning a role at
 * creation time requires that permission in addition to core.users.create, enforced server-side;
 * this only decides whether to render the control at all. */
export function CreateUserForm({ roles }: { roles: Role[] }): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/users', {
        method: 'POST',
        body: { email, fullName, password, ...(roleId ? { roleId } : {}) },
      });
      router.push('/users');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the user. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Full name
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
        Temporary password
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
      {roles.length > 0 && (
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Role
          <select
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">No role (assign later)</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create user'}
      </button>
    </form>
  );
}
