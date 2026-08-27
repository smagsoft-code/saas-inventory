'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { Role, TenantUser } from '../../../../lib/types/core';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { Alert } from '../../../../components/ui/alert';

interface Props {
  targetUser: TenantUser;
  canEditFullName: boolean;
  canEditStatus: boolean;
  canEditRole: boolean;
  roles: Role[];
  currentRoleId: string;
}

/** Which fields are editable is decided by the server component (self vs. others, which
 * permissions the caller holds) and passed in as flags; this form never re-derives that. The API
 * re-checks all of it regardless (CLAUDE.md §7.6). */
export function EditUserForm({
  targetUser,
  canEditFullName,
  canEditStatus,
  canEditRole,
  roles,
  currentRoleId,
}: Props): React.JSX.Element {
  const router = useRouter();
  const [fullName, setFullName] = useState(targetUser.fullName);
  const [status, setStatus] = useState(targetUser.status);
  const [roleId, setRoleId] = useState(currentRoleId);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const body: Record<string, string> = {};
      if (canEditFullName && fullName !== targetUser.fullName) body['fullName'] = fullName;
      if (canEditStatus && status !== targetUser.status) body['status'] = status;
      if (canEditRole && roleId && roleId !== currentRoleId) body['roleId'] = roleId;

      await apiFetch(`/api/v1/users/${targetUser.id}`, { method: 'PATCH', body });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!canEditFullName && !canEditStatus && !canEditRole) {
    return (
      <p className="text-sm text-slate-500">You don&apos;t have permission to edit this user.</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <Field label="Full name" required>
        <Input
          required
          minLength={2}
          disabled={!canEditFullName}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
      </Field>
      {canEditStatus && (
        <Field label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="invited">Invited</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </Select>
        </Field>
      )}
      {canEditRole && (
        <Field label="Role">
          <Select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            <option value="">No role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Saved.</Alert>}
      <Button type="submit" loading={submitting} className="w-fit">
        Save
      </Button>
    </form>
  );
}
