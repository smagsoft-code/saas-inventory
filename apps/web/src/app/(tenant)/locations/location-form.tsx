'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { INVENTORY_CODE_PATTERN, type Location } from '../../../lib/types/inventory';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

const LOCATIONS_PATH = '/api/v1/locations';

export interface WarehouseOption {
  id: string;
  name: string;
}

/** A candidate parent location — only `id`, `warehouseId`, `name`, `code` are used. */
export interface ParentLocationOption {
  id: string;
  warehouseId: string;
  name: string;
  code: string;
}

/**
 * Create / edit a location. Sends exactly the real DTO fields — `POST /locations` (create,
 * `locations.manage`) or `PATCH /locations/:id` (edit, changed fields only). `warehouseId` is set
 * once on create — no endpoint moves a location to another warehouse, so the edit form shows it
 * read-only. `parentLocationId` candidates are filtered to the selected warehouse client-side; the
 * backend re-validates (same-warehouse, no self-parent).
 */
export function LocationForm({
  mode,
  location,
  warehouses,
  parentCandidates,
}: {
  mode: 'create' | 'edit';
  location?: Location;
  warehouses: WarehouseOption[];
  parentCandidates: ParentLocationOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(
    location?.warehouseId ?? warehouses[0]?.id ?? '',
  );
  const [name, setName] = useState(location?.name ?? '');
  const [code, setCode] = useState(location?.code ?? '');
  const [parentLocationId, setParentLocationId] = useState(location?.parentLocationId ?? '');
  const [isSellable, setIsSellable] = useState(location?.isSellable ?? true);
  const [status, setStatus] = useState<'active' | 'inactive'>(
    (location?.status as 'active' | 'inactive') ?? 'active',
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; code?: string; warehouseId?: string }>(
    {},
  );
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const parentOptions = useMemo(
    () =>
      parentCandidates.filter(
        (candidate) => candidate.warehouseId === warehouseId && candidate.id !== location?.id,
      ),
    [parentCandidates, warehouseId, location],
  );

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return name.trim().length > 0 || code.trim().length > 0;
    }
    return (
      name.trim() !== location?.name ||
      code.trim() !== location?.code ||
      (parentLocationId || undefined) !== (location?.parentLocationId ?? undefined) ||
      isSellable !== location?.isSellable ||
      status !== location?.status
    );
  }, [mode, name, code, parentLocationId, isSellable, status, location]);

  function validate(): boolean {
    const next: { name?: string; code?: string; warehouseId?: string } = {};
    if (mode === 'create' && !warehouseId) {
      next.warehouseId = 'Elige una sucursal.';
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 120) {
      next.name = 'El nombre debe tener 1–120 caracteres.';
    }
    const trimmedCode = code.trim();
    if (trimmedCode.length < 1 || trimmedCode.length > 40 || !INVENTORY_CODE_PATTERN.test(trimmedCode)) {
      next.code = 'El código debe tener mayúsculas y números, opcionalmente separados por guiones.';
    }
    setFieldError(next);
    return Object.keys(next).length === 0;
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
        const created = await apiFetch<Location>(LOCATIONS_PATH, {
          method: 'POST',
          body: {
            warehouseId,
            name: name.trim(),
            code: code.trim(),
            ...(parentLocationId ? { parentLocationId } : {}),
            ...(isSellable ? {} : { isSellable: false }),
          },
        });
        router.replace(`/locations/${created.id}`);
        router.refresh();
        return;
      }
      const body: Record<string, unknown> = {};
      if (name.trim() !== location?.name) body['name'] = name.trim();
      if (code.trim() !== location?.code) body['code'] = code.trim();
      if ((parentLocationId || undefined) !== (location?.parentLocationId ?? undefined)) {
        body['parentLocationId'] = parentLocationId || undefined;
      }
      if (isSellable !== location?.isSellable) body['isSellable'] = isSellable;
      if (status !== location?.status) body['status'] = status;
      await apiFetch<Location>(`${LOCATIONS_PATH}/${location!.id}`, { method: 'PATCH', body });
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
      {mode === 'create' ? (
        <Field
          label="Sucursal"
          required
          {...(fieldError.warehouseId ? { error: fieldError.warehouseId } : {})}
        >
          <Select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setParentLocationId('');
              setSuccess(false);
            }}
          >
            {warehouses.length === 0 && <option value="">Sin sucursales activas</option>}
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Sucursal" hint="Un almacén no se puede mover a otra sucursal.">
          <Input
            readOnly
            value={warehouses.find((w) => w.id === warehouseId)?.name ?? warehouseId}
          />
        </Field>
      )}

      <Field label="Nombre" required {...(fieldError.name ? { error: fieldError.name } : {})}>
        <Input
          required
          minLength={1}
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
        hint="Mayúsculas y números, opcionalmente separados por guiones. Único dentro de la sucursal."
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

      <Field label="Almacén padre" hint="Opcional. Debe estar en la misma sucursal.">
        <Select
          value={parentLocationId}
          onChange={(e) => {
            setParentLocationId(e.target.value);
            setSuccess(false);
          }}
        >
          <option value="">Ninguno (nivel superior)</option>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.code})
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Vendible" hint="Desactívalo para almacenes de cuarentena, dañados o descarte.">
        <Select
          value={isSellable ? 'yes' : 'no'}
          onChange={(e) => {
            setIsSellable(e.target.value === 'yes');
            setSuccess(false);
          }}
        >
          <option value="yes">Sí — el stock aquí está disponible para vender</option>
          <option value="no">No — no vendible</option>
        </Select>
      </Field>

      {mode === 'edit' && (
        <Field label="Estado">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as 'active' | 'inactive');
              setSuccess(false);
            }}
          >
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </Select>
        </Field>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Almacén guardado.</Alert>}

      <div className="flex gap-2">
        <Button
          type="submit"
          loading={submitting}
          disabled={!dirty || (mode === 'create' && warehouses.length === 0)}
          className="w-fit"
        >
          {mode === 'create' ? 'Crear almacén' : 'Guardar cambios'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => router.push('/locations')}
        >
          {mode === 'create' ? 'Cancelar' : 'Volver a almacenes'}
        </Button>
      </div>
    </form>
  );
}
