'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { UserLocationAssignment } from '../../../../lib/inventory/user-locations';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';

interface LocationOption {
  id: string;
  name: string;
  warehouseName: string;
  status: string;
}

/**
 * Location-access editor for `S-USER-DETAIL` — `GET/PUT /api/v1/users/:userId/locations`
 * (`core.users.locations.manage`). ADR-0024: a user with **zero** assignments is **unrestricted**
 * (every tenant location); a non-empty set restricts operations (adjustments, transfer
 * prepare/dispatch/receive) to those locations. `PUT` replaces the whole set; body is exactly
 * `SetUserLocationsDto { locationIds }` — never `tenantId`/`userId`/anything else. `apiFetch`
 * attaches the CSRF header; the backend re-checks permission + tenant + that every id is in-tenant.
 *
 * This only manages the assignment rows. It does not touch `LocationAuthorizationService` or any
 * inventory operation — those re-read the assignments live on every write.
 */
export function LocationAccess({
  userId,
  userName,
  initialAssignments,
  locations,
}: {
  userId: string;
  userName: string;
  initialAssignments: UserLocationAssignment[];
  locations: LocationOption[];
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
      setError('Select at least one location, or choose "Unrestricted".');
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
          ? 'Saved — this user can operate on every location.'
          : `Saved — this user is restricted to ${nextIds.length} location(s).`,
      );
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'You are not authorized to change this user’s location access.'
          : httpErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-slate-600">
          Controls which physical locations <span className="font-medium">{userName}</span> may
          operate on for stock adjustments and transfers (ADR-0024). Viewing stock is not affected.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Location access mode</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="location-access-mode"
            className="mt-0.5"
            checked={!restricted}
            onChange={() => {
              setRestricted(false);
              setNotice(null);
            }}
            disabled={busy}
          />
          <span>
            <span className="font-medium text-slate-800">Unrestricted</span>
            <span className="block text-xs text-slate-500">Can operate on every location in the company.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="location-access-mode"
            className="mt-0.5"
            checked={restricted}
            onChange={() => {
              setRestricted(true);
              setNotice(null);
            }}
            disabled={busy}
          />
          <span>
            <span className="font-medium text-slate-800">Restrict to selected locations</span>
            <span className="block text-xs text-slate-500">Operations outside these are refused by the backend.</span>
          </span>
        </label>
      </fieldset>

      {restricted && (
        <div className="flex flex-col gap-1 rounded-md border border-slate-200 p-3">
          {activeLocations.length === 0 ? (
            <p className="text-sm text-slate-500">This company has no active locations.</p>
          ) : (
            activeLocations.map((location) => (
              <label key={location.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(location.id)}
                  onChange={() => toggle(location.id)}
                  disabled={busy}
                />
                <span className="text-slate-800">{location.name}</span>
                <span className="text-xs text-slate-400">{location.warehouseName}</span>
                {location.status !== 'active' && (
                  <span className="text-xs text-amber-700">(inactive)</span>
                )}
              </label>
            ))
          )}
        </div>
      )}

      <div>
        <Button loading={busy} disabled={busy || !dirty} onClick={() => void save()}>
          Save location access
        </Button>
      </div>
    </div>
  );
}
