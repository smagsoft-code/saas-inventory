'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { PermissionCatalogItem } from '../../../../lib/types/core';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Textarea } from '../../../../components/ui/input';
import { PermissionPicker } from '../permission-picker';

export function RoleCreateForm({ catalog }: { catalog: PermissionCatalogItem[] }): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissionCodes, setPermissionCodes] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(code: string): void {
    setPermissionCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/v1/roles', {
        method: 'POST',
        body: { name, description: description || undefined, permissionCodes: [...permissionCodes] },
      });
      router.push(`/roles/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex max-w-sm flex-col gap-4">
        <Field label="Nombre del rol" required>
          <Input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Descripción">
          <Textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
        </Field>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Permisos</h2>
        <PermissionPicker catalog={catalog} selected={permissionCodes} onToggle={toggle} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={submitting} className="w-fit">
        Crear rol
      </Button>
    </form>
  );
}
