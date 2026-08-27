'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import type { Tenant } from '../../../lib/types/core';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Alert } from '../../../components/ui/alert';

/** Only `name` is ever sent — slug/status/isDemo are system-managed and have no field here, so
 * nothing client-side can attempt to send them; the backend DTO whitelist rejects them regardless
 * (defense in depth). */
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
      setError(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <Field label="Company name" required error={error}>
        <Input
          required
          minLength={2}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {success && <Alert tone="success">Saved.</Alert>}
      <Button type="submit" loading={submitting} className="w-fit">
        Save
      </Button>
    </form>
  );
}
