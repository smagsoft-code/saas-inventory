'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../lib/api-client';
import type { Tenant } from '../../../lib/core-types';

/** Only `name` is ever sent — §7/§9: slug/status/isDemo are system-managed and have no field
 * here at all, so there is nothing client-side that could even attempt to send them. The backend
 * DTO whitelist rejects them regardless (defense in depth, not the only line of defense). */
export function TenantSettingsForm({ tenant }: { tenant: Tenant }): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(tenant.name);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/tenant', { method: 'PATCH', body: { name } });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the company name. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Company name
        <input
          required
          minLength={2}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
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
