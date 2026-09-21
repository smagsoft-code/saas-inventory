'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { Role } from '../../../../lib/types/core';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Textarea } from '../../../../components/ui/input';

/** Name/description only. ADR-0034 blocks permission changes on the caller's own role, never
 * renaming/describing — this form stays fully enabled even when `role.isAssignedToCaller`. */
export function RoleEditForm({ role, canManage }: { role: Role; canManage: boolean }): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!canManage) {
    return <p className="text-sm text-slate-500">Necesitas el permiso de gestión de roles para editar este rol.</p>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const body: Record<string, string> = {};
      if (name !== role.name) body['name'] = name;
      if (description !== (role.description ?? '')) body['description'] = description;

      await apiFetch(`/api/v1/roles/${role.id}`, { method: 'PATCH', body });
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
      <Field label="Nombre del rol" required>
        <Input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Descripción">
        <Textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Guardado.</Alert>}
      <Button type="submit" loading={submitting} className="w-fit">
        Guardar
      </Button>
    </form>
  );
}
