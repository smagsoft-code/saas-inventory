'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { listSupportedTimezones } from '../../../lib/tenant/timezones';
import type { TenantSettings } from '../../../lib/types/tenant-settings';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/input';

const SETTINGS_PATH = '/api/v1/administration/tenant-settings';

/**
 * Edits `tenant_settings.timezone` via `PATCH /administration/tenant-settings`
 * (`administration.settings.manage`). Only `timezone` is sent — `businessHours` is omitted so the
 * PATCH leaves it untouched. The option list is `Intl.supportedValuesOf('timeZone')`, the exact
 * set the server validates against.
 */
export function RegionalSettingsForm({
  timezone,
  usingDefaults,
  canManage,
}: {
  timezone: string;
  usingDefaults: boolean;
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(timezone);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const options = useMemo(() => {
    const zones = listSupportedTimezones();
    // Keep a currently-saved value visible even if this runtime doesn't list it.
    return zones.includes(timezone) ? zones : [timezone, ...zones];
  }, [timezone]);

  const dirty = value !== timezone;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Timezone</span>
        <span className="text-slate-900">{timezone}</span>
        {usingDefaults && <span className="text-xs text-slate-500">Using the system default.</span>}
        <span className="text-xs text-slate-500">
          You don&apos;t have permission to change this.
        </span>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const updated = await apiFetch<TenantSettings>(SETTINGS_PATH, {
        method: 'PATCH',
        body: { timezone: value },
      });
      setValue(updated.timezone);
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'You no longer have permission to change this.'
          : httpErrorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const hint = usingDefaults
    ? 'Currently using the system default (UTC). Choose your timezone and save.'
    : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <Field label="Timezone" error={error} {...(hint ? { hint } : {})}>
        <Select
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSuccess(false);
          }}
        >
          {options.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </Field>
      {success && (
        <Alert tone="success">Timezone saved.</Alert>
      )}
      <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
        Save timezone
      </Button>
    </form>
  );
}
