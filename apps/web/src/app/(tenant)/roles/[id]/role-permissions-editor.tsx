'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { PermissionCatalogItem, Role } from '../../../../lib/types/core';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { PermissionPicker } from '../permission-picker';

/**
 * `PUT /roles/:id/permissions` — ADR-0034: rejected (403, `ROLE_SELF_PERMISSION_ESCALATION`)
 * whenever the target role is currently assigned to the caller, regardless of `core.roles.manage`.
 * `role.isAssignedToCaller` (from the same `GET /roles/:id` response) disables the picker
 * client-side with an explanation — the backend enforces the actual rule either way (CLAUDE.md
 * §7.6), this only avoids letting someone fill out a form the API will refuse.
 */
export function RolePermissionsEditor({ role, catalog }: { role: Role; catalog: PermissionCatalogItem[] }): React.JSX.Element {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role.permissionCodes));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty =
    selected.size !== role.permissionCodes.length || role.permissionCodes.some((code) => !selected.has(code));

  function toggle(code: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setSuccess(false);
  }

  async function save(): Promise<void> {
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/roles/${role.id}/permissions`, {
        method: 'PUT',
        body: { permissionCodes: [...selected] },
      });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.code === 'ROLE_SELF_PERMISSION_ESCALATION'
          ? 'No puedes modificar los permisos de un rol que tú mismo tienes asignado actualmente. Pídele a otro administrador que lo haga.'
          : httpErrorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (role.isAssignedToCaller) {
    return (
      <Alert tone="info">
        Este es tu rol actual — no puedes modificar sus permisos tú mismo (evita que te auto-otorgues
        permisos). Pídele a otro administrador que lo edite, o edita el nombre/descripción arriba.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PermissionPicker catalog={catalog} selected={selected} onToggle={toggle} disabled={submitting} />
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Guardado.</Alert>}
      <Button loading={submitting} disabled={submitting || !dirty} onClick={() => void save()} className="w-fit">
        Guardar permisos
      </Button>
    </div>
  );
}
