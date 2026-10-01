'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import {
  ADDRESS_FIELDS,
  ADDRESS_FIELD_LABELS,
  INVENTORY_CODE_PATTERN,
  type AddressField,
  type Warehouse,
  type WarehouseAddress,
} from '../../../lib/types/inventory';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

const WAREHOUSES_PATH = '/api/v1/warehouses';

/** Reads the free-form `address` object into the fixed field set this form edits. Unknown keys are
 * left untouched on the server (a partial PATCH never sends `address` unless the user edits it). */
function toAddressState(address: Record<string, unknown> | undefined): Record<AddressField, string> {
  const out = {} as Record<AddressField, string>;
  for (const key of ADDRESS_FIELDS) {
    const value = address?.[key];
    out[key] = typeof value === 'string' ? value : '';
  }
  return out;
}

/** Only non-empty fields are sent; an all-empty address becomes `undefined`. */
function toAddressPayload(state: Record<AddressField, string>): WarehouseAddress | undefined {
  const entries = ADDRESS_FIELDS.map((key) => [key, state[key].trim()] as const).filter(
    ([, value]) => value.length > 0,
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as WarehouseAddress) : undefined;
}

function addressEqual(a: WarehouseAddress | undefined, b: WarehouseAddress | undefined): boolean {
  return ADDRESS_FIELDS.every((key) => (a?.[key] ?? '') === (b?.[key] ?? ''));
}

/**
 * Create / edit a warehouse. Sends exactly the real DTO fields — `POST /warehouses` (create,
 * `warehouses.manage`) or `PATCH /warehouses/:id` (edit, changed fields only). `status` only
 * exists on edit (`UpdateWarehouseDto`). Client validation mirrors the backend (`Length`, code
 * pattern); the backend is the authority for code uniqueness.
 */
export function WarehouseForm({
  mode,
  warehouse,
}: {
  mode: 'create' | 'edit';
  warehouse?: Warehouse;
}): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(warehouse?.name ?? '');
  const [code, setCode] = useState(warehouse?.code ?? '');
  const [address, setAddress] = useState<Record<AddressField, string>>(
    toAddressState(warehouse?.address),
  );
  const [status, setStatus] = useState<'active' | 'inactive'>(
    (warehouse?.status as 'active' | 'inactive') ?? 'active',
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; code?: string }>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const originalAddress = useMemo(() => toAddressState(warehouse?.address), [warehouse]);

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return name.trim().length > 0 || code.trim().length > 0;
    }
    return (
      name.trim() !== warehouse?.name ||
      code.trim() !== warehouse?.code ||
      status !== warehouse?.status ||
      !addressEqual(toAddressPayload(address), toAddressPayload(originalAddress))
    );
  }, [mode, name, code, status, address, warehouse, originalAddress]);

  function validate(): boolean {
    const next: { name?: string; code?: string } = {};
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      next.name = 'El nombre debe tener 2–120 caracteres.';
    }
    const trimmedCode = code.trim();
    if (trimmedCode.length < 1 || trimmedCode.length > 40 || !INVENTORY_CODE_PATTERN.test(trimmedCode)) {
      next.code = 'El código debe tener mayúsculas y números, opcionalmente separados por guiones.';
    }
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  function setAddressField(key: AddressField, value: string): void {
    setAddress((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    if (!validate()) {
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const addressPayload = toAddressPayload(address);
        const created = await apiFetch<Warehouse>(WAREHOUSES_PATH, {
          method: 'POST',
          body: {
            name: name.trim(),
            code: code.trim(),
            ...(addressPayload ? { address: addressPayload } : {}),
          },
        });
        router.replace(`/warehouses/${created.id}`);
        router.refresh();
        return;
      }
      const body: Record<string, unknown> = {};
      if (name.trim() !== warehouse?.name) body['name'] = name.trim();
      if (code.trim() !== warehouse?.code) body['code'] = code.trim();
      if (status !== warehouse?.status) body['status'] = status;
      const nextAddress = toAddressPayload(address);
      if (!addressEqual(nextAddress, toAddressPayload(originalAddress))) {
        body['address'] = nextAddress ?? {};
      }
      await apiFetch<Warehouse>(`${WAREHOUSES_PATH}/${warehouse!.id}`, { method: 'PATCH', body });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('Ya no tienes permiso para hacer este cambio.');
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <Field label="Nombre" required {...(fieldError.name ? { error: fieldError.name } : {})}>
        <Input
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <Field
        label="Código"
        required
        hint="Mayúsculas y números, opcionalmente separados por guiones. Único dentro de la empresa."
        {...(fieldError.code ? { error: fieldError.code } : {})}
      >
        <Input
          required
          maxLength={40}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setSuccess(false);
          }}
        />
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-500">Dirección (opcional)</legend>
        {ADDRESS_FIELDS.map((key) => (
          <Field key={key} label={ADDRESS_FIELD_LABELS[key]}>
            <Input
              value={address[key]}
              onChange={(e) => setAddressField(key, e.target.value)}
            />
          </Field>
        ))}
      </fieldset>

      {mode === 'edit' && (
        <Field label="Estado">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as 'active' | 'inactive');
              setSuccess(false);
            }}
          >
            <option value="active">Activa</option>
            <option value="inactive">Inactiva</option>
          </Select>
        </Field>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Sucursal guardada.</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
          {mode === 'create' ? 'Crear sucursal' : 'Guardar cambios'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => router.push('/warehouses')}
        >
          {mode === 'create' ? 'Cancelar' : 'Volver a sucursales'}
        </Button>
      </div>
    </form>
  );
}
