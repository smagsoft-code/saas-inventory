'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { Role } from '../../../../lib/types/core';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { Alert } from '../../../../components/ui/alert';

/** `roles` is passed in only when the caller holds `core.roles.assign` — assigning a role at
 * creation requires that permission in addition to `core.users.create`, enforced server-side;
 * this only decides whether to render the control. */
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
      setError(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <Field label="Full name" required>
        <Input
          required
          minLength={2}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          autoComplete="name"
        />
      </Field>
      <Field label="Email" required>
        <Input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field label="Temporary password" required hint="Minimum 10 characters.">
        <Input
          type="password"
          required
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
      </Field>
      {roles.length > 0 && (
        <Field label="Role">
          <Select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            <option value="">No role (assign later)</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={submitting} className="w-fit">
        Create user
      </Button>
    </form>
  );
}
