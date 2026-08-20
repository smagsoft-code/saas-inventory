'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api-client';
import type { Role, TenantUser } from '../../../../lib/core-types';

interface Props {
  targetUser: TenantUser;
  canEditFullName: boolean;
  canEditStatus: boolean;
  canEditRole: boolean;
  roles: Role[];
  currentRoleId: string;
}

/** Which fields are even editable is decided by the server component (self vs. others, and which
 * permissions the caller holds — §16/§21) and passed in as flags; this form never re-derives that
 * itself. The API re-checks all of it regardless — this only avoids showing controls that would
 * fail anyway (CLAUDE.md §7.6). */
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
      setError(err instanceof ApiError ? err.message : 'Could not update this user. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canEditFullName && !canEditStatus && !canEditRole) {
    return <p className="text-sm text-slate-500">You don&apos;t have permission to edit this user.</p>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Full name
        <input
          required
          minLength={2}
          disabled={!canEditFullName}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2 disabled:bg-slate-50 disabled:text-slate-400"
        />
      </label>
      {canEditStatus && (
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="invited">Invited</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      )}
      {canEditRole && (
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Role
          <select
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">No role</option>
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
      {success && <p className="text-sm text-green-600">Saved.</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
