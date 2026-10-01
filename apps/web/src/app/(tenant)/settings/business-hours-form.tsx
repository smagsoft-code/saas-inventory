'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import type { BusinessHoursEntry, TenantSettings } from '../../../lib/types/tenant-settings';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

const SETTINGS_PATH = '/api/v1/administration/tenant-settings';
const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** One editable row per weekday. A day is only sent to the server when `enabled` — an absent day
 * means "no hours configured", the same meaning the backend gives an empty array. */
interface DayState {
  enabled: boolean;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
}

function toDayStates(entries: BusinessHoursEntry[]): DayState[] {
  return DAY_LABELS.map((_, day) => {
    const entry = entries.find((e) => e.dayOfWeek === day);
    return {
      enabled: entry !== undefined,
      isClosed: entry?.isClosed ?? false,
      opensAt: entry?.opensAt ?? '09:00',
      closesAt: entry?.closesAt ?? '18:00',
    };
  });
}

function toEntries(days: DayState[]): BusinessHoursEntry[] {
  return days
    .map((d, dayOfWeek): BusinessHoursEntry | null => {
      if (!d.enabled) return null;
      return d.isClosed
        ? { dayOfWeek, isClosed: true }
        : { dayOfWeek, isClosed: false, opensAt: d.opensAt, closesAt: d.closesAt };
    })
    .filter((e): e is BusinessHoursEntry => e !== null);
}

/** Client-side mirror of the server's cross-field rule (`opensAt < closesAt` on an open day).
 * The server is still the authority — this is fast feedback (F17-02 §13). */
function localValidationError(days: DayState[]): string | null {
  for (let day = 0; day < days.length; day += 1) {
    const d = days[day];
    if (d && d.enabled && !d.isClosed && d.opensAt >= d.closesAt) {
      return `${DAY_LABELS[day]}: la hora de apertura debe ser anterior a la de cierre.`;
    }
  }
  return null;
}

export function BusinessHoursForm({
  businessHours,
  canManage,
}: {
  businessHours: BusinessHoursEntry[];
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const initial = useMemo(() => toDayStates(businessHours), [businessHours]);
  const [days, setDays] = useState<DayState[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = JSON.stringify(toEntries(days)) !== JSON.stringify(businessHours);

  if (!canManage) {
    const configured = businessHours.length > 0;
    return (
      <div className="text-sm text-slate-500">
        {configured ? (
          <ul className="flex flex-col gap-1">
            {businessHours
              .slice()
              .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
              .map((e) => (
                <li key={e.dayOfWeek} className="text-slate-900">
                  {DAY_LABELS[e.dayOfWeek]}:{' '}
                  {e.isClosed ? 'Cerrado' : `${e.opensAt}–${e.closesAt}`}
                </li>
              ))}
          </ul>
        ) : (
          <p>No hay horario comercial configurado.</p>
        )}
        <p className="mt-2 text-xs">No tienes permiso para cambiar esto.</p>
      </div>
    );
  }

  function update(day: number, patch: Partial<DayState>): void {
    setDays((current) => current.map((d, i) => (i === day ? { ...d, ...patch } : d)));
    setSuccess(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    const localError = localValidationError(days);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const updated = await apiFetch<TenantSettings>(SETTINGS_PATH, {
        method: 'PATCH',
        body: { businessHours: toEntries(days) },
      });
      setDays(toDayStates(updated.businessHours));
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'Ya no tienes permiso para cambiar esto.'
          : httpErrorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col divide-y divide-slate-100">
        {days.map((d, day) => (
          <div key={day} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-4">
            <label className="flex w-40 shrink-0 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={d.enabled}
                onChange={(e) => update(day, { enabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              {DAY_LABELS[day]}
            </label>
            {d.enabled && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={d.isClosed}
                    onChange={(e) => update(day, { isClosed: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Cerrado
                </label>
                {!d.isClosed && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`Hora de apertura del ${DAY_LABELS[day]}`}
                      value={d.opensAt}
                      onChange={(e) => update(day, { opensAt: e.target.value })}
                      className="w-32"
                    />
                    <span className="text-slate-400" aria-hidden>
                      –
                    </span>
                    <Input
                      type="time"
                      aria-label={`Hora de cierre del ${DAY_LABELS[day]}`}
                      value={d.closesAt}
                      onChange={(e) => update(day, { closesAt: e.target.value })}
                      className="w-32"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Horario comercial guardado.</Alert>}
      <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
        Guardar horario comercial
      </Button>
    </form>
  );
}
