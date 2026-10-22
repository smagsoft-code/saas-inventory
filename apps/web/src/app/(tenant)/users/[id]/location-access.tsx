'use client';
import { HelpTip } from '../../../../components/ui/help-tip';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { UserLocationAssignment } from '../../../../lib/inventory/user-locations';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { LocationScopePicker, type LocationScopeOption } from '../location-scope-picker';

/**
 * Location-access editor for `S-USER-DETAIL` — `GET/PUT /api/v1/users/:userId/locations`
 * (`core.users.locations.manage`). `PUT` replaces the whole set; body is exactly
 * `SetUserLocationsDto { locationIds }` — never `tenantId`/`userId`/anything else. `apiFetch`
 * attaches the CSRF header; the backend re-checks permission + tenant + that every id is in-tenant.
 *
 * ADR-0035 (supersedes ADR-0024's default): an empty set now means the user cannot operate
 * inventory anywhere — not "unrestricted" — except for the tenant's founding, system-default
 * Administrador role, which the backend always allows regardless of this table's contents. When
 * `isFoundingAdministrador` is true, this renders an explanatory notice instead of the picker,
 * since assigning locations to that role has no operational effect (ADR-0035's own documented
 * consequence) — editing it here would silently do nothing, which is worse than not offering it.
 *
 * This only manages the assignment rows. It does not touch `LocationAuthorizationService` or any
 * inventory operation — those re-read the assignments live on every write.
 */
export function LocationAccess({
  userId,
  userName,
  initialAssignments,
  locations,
  isFoundingAdministrador,
}: {
  userId: string;
  userName: string;
  initialAssignments: UserLocationAssignment[];
  locations: LocationScopeOption[];
  isFoundingAdministrador: boolean;
}): React.JSX.Element {
  const router = useRouter();

  const initiallyRestricted = initialAssignments.length > 0;
  const initialIds = useMemo(
    () => new Set(initialAssignments.map((a) => a.locationId)),
    [initialAssignments],
  );
  const [restricted, setRestricted] = useState(initiallyRestricted);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeLocations = locations.filter(
    (l) => l.status === 'active' || initialIds.has(l.id),
  );

  const nextIds = restricted ? [...selected] : [];
  const dirty =
    restricted !== initiallyRestricted ||
    nextIds.length !== initialIds.size ||
    nextIds.some((id) => !initialIds.has(id));

  function toggle(id: string): void {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setNotice(null);
  }

  async function save(): Promise<void> {
    if (busy) return;
    if (restricted && nextIds.length === 0) {
      setError('Selecciona al menos una ubicación, o elige "Sin ubicación asignada".');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/users/${userId}/locations`, {
        method: 'PUT',
        body: { locationIds: nextIds },
      });
      setNotice(
        nextIds.length === 0
          ? 'Guardado — sin ubicación asignada, este usuario no podrá operar inventario hasta que se le asigne una.'
          : `Guardado — este usuario está autorizado en ${nextIds.length} ubicación(es).`,
      );
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'No tienes autorización para cambiar el acceso a almacenes de este usuario.'
          : httpErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isFoundingAdministrador) {
    return (
      <Alert tone="info">
        <span className="font-medium text-slate-800">{userName}</span> tiene el rol predefinido
        Administrador — siempre puede operar inventario en cualquier almacén, sin importar la
        asignación de ubicaciones (ADR-0035). Asignarle ubicaciones aquí no tendría efecto.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1.5 text-sm text-slate-600">
        Alcance operativo de <span className="font-medium">{userName}</span>
        <HelpTip>
          Controla en qué almacenes/ubicaciones puede operar <span className="font-medium">{userName}</span>{' '}
          (venta, ajustes de inventario, transferencias). Ver el inventario de otros almacenes no se ve afectado.
        </HelpTip>
      </p>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <LocationScopePicker
        locations={activeLocations}
        restricted={restricted}
        onRestrictedChange={(value) => {
          setRestricted(value);
          setNotice(null);
        }}
        selected={selected}
        onToggle={toggle}
        disabled={busy}
      />

      <div>
        <Button loading={busy} disabled={busy || !dirty} onClick={() => void save()}>
          Guardar acceso a almacenes
        </Button>
      </div>
    </div>
  );
}
