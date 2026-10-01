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

/** Edits the company name via `PATCH /tenant` (`core.tenant.update`). Only `name` is ever sent —
 * `slug`/`status`/`isDemo` are system-managed and have no field here, so nothing client-side can
 * attempt to send them; the backend DTO whitelist rejects them regardless (defense in depth). */
export function TenantSettingsForm({ tenant }: { tenant: Tenant }): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(tenant.name);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = name.trim() !== tenant.name;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/tenant', { method: 'PATCH', body: { name: name.trim() } });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <Field label="Nombre de la empresa" required error={error}>
        <Input
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSuccess(false);
          }}
        />
      </Field>
      {success && <Alert tone="success">Nombre de la empresa guardado.</Alert>}
      <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
        Guardar
      </Button>
    </form>
  );
}
