'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { Role } from '../../../../lib/types/core';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { Alert } from '../../../../components/ui/alert';
import { LocationScopePicker, type LocationScopeOption } from '../location-scope-picker';

/** `roles` is passed in only when the caller holds `core.roles.assign`; `locationOptions` only
 * when they hold `core.users.locations.manage` — assigning either at creation requires that
 * permission, enforced server-side; this only decides whether to render the control.
 *
 * Single flow, two calls: `POST /users` first, then — only if the admin picked a location scope
 * and the role selected is not the tenant's founding, system-default Administrador (ADR-0035: it
 * would have no effect) — `PUT /users/:id/locations` on the just-created id, reusing the exact
 * same endpoint `/users/[id]`'s `LocationAccess` editor uses. No parallel assignment mechanism.
 * If the first call succeeds but the second fails, the user still exists — this never rolls it
 * back or leaves the admin without a way to finish the assignment (a link to its detail page). */
export function CreateUserForm({
  roles,
  locationOptions,
}: {
  roles: Role[];
  locationOptions: LocationScopeOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [scopeRestricted, setScopeRestricted] = useState(false);
  const [scopeSelected, setScopeSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedRole = roles.find((role) => role.id === roleId);
  const isFoundingAdministrador = Boolean(selectedRole?.isSystemDefault && selectedRole.name === 'Administrador');

  const scopeLocationIds = useMemo(() => (scopeRestricted ? [...scopeSelected] : []), [scopeRestricted, scopeSelected]);

  function toggleLocation(id: string): void {
    setScopeSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (scopeRestricted && scopeLocationIds.length === 0) {
      setError('Selecciona al menos una ubicación, o elige "Sin ubicación asignada".');
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/v1/users', {
        method: 'POST',
        body: { email, fullName, password, ...(roleId ? { roleId } : {}) },
      });

      if (locationOptions.length > 0 && !isFoundingAdministrador && scopeRestricted) {
        try {
          await apiFetch(`/api/v1/users/${created.id}/locations`, {
            method: 'PUT',
            body: { locationIds: scopeLocationIds },
          });
        } catch (locationErr) {
          setError(
            `El usuario se creó, pero no se pudo guardar su almacén asignado (${httpErrorMessage(locationErr)}). ` +
              `Complétalo desde su ficha.`,
          );
          router.push(`/users/${created.id}`);
          router.refresh();
          return;
        }
      }

      router.push(`/users/${created.id}`);
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
        <Field label="Nombre completo" required>
          <Input
            required
            minLength={2}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
          />
        </Field>
        <Field label="Usuario" required hint="No necesita tener formato de correo.">
          <Input
            type="text"
            required
            minLength={1}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </Field>
        <Field label="Contraseña temporal" required hint="Mínimo 10 caracteres.">
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
          <Field label="Rol">
            <Select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              <option value="">Sin rol (asignar después)</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {locationOptions.length > 0 && (
        <div className="flex max-w-md flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Almacén / alcance operativo</h2>
          <p className="text-xs text-slate-500">
            Define dónde puede operar inventario este usuario (venta, ajustes, transferencias) — separado del rol, que define qué puede hacer.
          </p>
          {isFoundingAdministrador ? (
            <Alert tone="info">
              El rol Administrador siempre puede operar en cualquier almacén — no necesita asignación (ADR-0035).
            </Alert>
          ) : (
            <LocationScopePicker
              locations={locationOptions}
              restricted={scopeRestricted}
              onRestrictedChange={setScopeRestricted}
              selected={scopeSelected}
              onToggle={toggleLocation}
              disabled={submitting}
            />
          )}
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={submitting} className="w-fit">
        Crear usuario
      </Button>
    </form>
  );
}
