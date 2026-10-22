'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import {
  ATTRIBUTE_DATA_TYPES,
  ATTRIBUTE_DATA_TYPE_LABELS,
  ATTRIBUTE_SCOPES,
  isNumericType,
  type AttributeDataType,
  type AttributeDefinition,
  type AttributeScope,
  type MeasurementUnit,
} from '../../../lib/types/catalog';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select, Textarea } from '../../../components/ui/input';

const PATH = '/api/v1/attribute-definitions';

/**
 * Create / edit an attribute definition. On **create** sends `CreateAttributeDefinitionDto`
 * (`code`, `dataType`, `appliesTo`, `unitId` are intrinsic and set once). On **edit** sends
 * `UpdateAttributeDefinitionDto` — only `name`, `description`, `isRequiredDefault`, `minValue`,
 * `maxValue` (numeric types only) and `status`. Intrinsic fields render read-only.
 *
 * Client rules mirror the service: `unitId`/`minValue`/`maxValue` only for `number`/`decimal`;
 * `minValue <= maxValue`. The backend is the authority for code uniqueness.
 */
export function AttributeForm({
  mode,
  definition,
  units,
}: {
  mode: 'create' | 'edit';
  definition?: AttributeDefinition;
  units: MeasurementUnit[];
}): React.JSX.Element {
  const router = useRouter();
  const [code, setCode] = useState(definition?.code ?? '');
  const [name, setName] = useState(definition?.name ?? '');
  const [description, setDescription] = useState(definition?.description ?? '');
  const [dataType, setDataType] = useState<AttributeDataType>(
    (definition?.dataType as AttributeDataType) ?? 'text',
  );
  const [appliesTo, setAppliesTo] = useState<AttributeScope>(
    (definition?.appliesTo as AttributeScope) ?? 'product',
  );
  const [unitId, setUnitId] = useState(definition?.unitId ?? '');
  const [isRequiredDefault, setIsRequiredDefault] = useState(definition?.isRequiredDefault ?? false);
  const [minValue, setMinValue] = useState(
    definition?.minValue !== undefined ? String(definition.minValue) : '',
  );
  const [maxValue, setMaxValue] = useState(
    definition?.maxValue !== undefined ? String(definition.maxValue) : '',
  );
  const [status, setStatus] = useState<'active' | 'inactive'>(
    (definition?.status as 'active' | 'inactive') ?? 'active',
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const numeric = isNumericType(dataType);

  const dirty = useMemo(() => {
    if (mode === 'create') return code.trim().length > 0 && name.trim().length > 0;
    return (
      name.trim() !== definition?.name ||
      (description.trim() || undefined) !== (definition?.description ?? undefined) ||
      isRequiredDefault !== definition?.isRequiredDefault ||
      (minValue.trim() || undefined) !==
        (definition?.minValue !== undefined ? String(definition.minValue) : undefined) ||
      (maxValue.trim() || undefined) !==
        (definition?.maxValue !== undefined ? String(definition.maxValue) : undefined) ||
      status !== definition?.status
    );
  }, [mode, code, name, description, isRequiredDefault, minValue, maxValue, status, definition]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (mode === 'create') {
      const c = code.trim();
      if (c.length < 1 || c.length > 60) {
        next['code'] = 'El código es obligatorio (1–60 caracteres).';
      }
    }
    if (name.trim().length < 1 || name.trim().length > 120) {
      next['name'] = 'El nombre es obligatorio (máx. 120 caracteres).';
    }
    if (numeric && minValue.trim() && maxValue.trim() && Number(minValue) > Number(maxValue)) {
      next['maxValue'] = 'El mínimo debe ser menor o igual que el máximo.';
    }
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty || !validate()) return;
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          code: code.trim(),
          name: name.trim(),
          dataType,
          appliesTo,
        };
        if (description.trim()) body['description'] = description.trim();
        if (isRequiredDefault) body['isRequiredDefault'] = true;
        if (numeric) {
          if (unitId) body['unitId'] = unitId;
          if (minValue.trim()) body['minValue'] = Number(minValue);
          if (maxValue.trim()) body['maxValue'] = Number(maxValue);
        }
        const created = await apiFetch<AttributeDefinition>(PATH, { method: 'POST', body });
        router.replace(`/attributes/${created.id}`);
        router.refresh();
        return;
      }
      const body: Record<string, unknown> = {};
      if (name.trim() !== definition?.name) body['name'] = name.trim();
      if ((description.trim() || undefined) !== (definition?.description ?? undefined)) {
        body['description'] = description.trim();
      }
      if (isRequiredDefault !== definition?.isRequiredDefault) {
        body['isRequiredDefault'] = isRequiredDefault;
      }
      if (numeric) {
        const before = definition?.minValue !== undefined ? String(definition.minValue) : '';
        const beforeMax = definition?.maxValue !== undefined ? String(definition.maxValue) : '';
        if (minValue.trim() !== before && minValue.trim()) body['minValue'] = Number(minValue);
        if (maxValue.trim() !== beforeMax && maxValue.trim()) body['maxValue'] = Number(maxValue);
      }
      if (status !== definition?.status) body['status'] = status;
      await apiFetch<AttributeDefinition>(`${PATH}/${definition!.id}`, { method: 'PATCH', body });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'Ya no tienes permiso para hacer este cambio.'
          : httpErrorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-lg flex-col gap-4">
      <Field
        label="Código"
        required
        help="Una clave estable usada en los datos. No se puede cambiar después."
        {...(fieldError['code'] ? { error: fieldError['code'] } : {})}
      >
        <Input
          required
          value={code}
          disabled={mode === 'edit'}
          onChange={(e) => {
            setCode(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <Field label="Nombre" required {...(fieldError['name'] ? { error: fieldError['name'] } : {})}>
        <Input
          required
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <Field label="Descripción">
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={'Tipo'} required {...(mode === 'edit' ? { help: 'No se puede cambiar.' } : {})}>
          <Select
            value={dataType}
            disabled={mode === 'edit'}
            onChange={(e) => {
              setDataType(e.target.value as AttributeDataType);
              setSuccess(false);
            }}
          >
            {ATTRIBUTE_DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {ATTRIBUTE_DATA_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={'Aplica a'} required {...(mode === 'edit' ? { help: 'No se puede cambiar.' } : {})}>
          <Select
            value={appliesTo}
            disabled={mode === 'edit'}
            onChange={(e) => {
              setAppliesTo(e.target.value as AttributeScope);
              setSuccess(false);
            }}
          >
            {ATTRIBUTE_SCOPES.map((s) => (
              <option key={s} value={s}>
                {s === 'variant' ? 'Variante' : 'Producto'}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {numeric && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={'Unidad'} help={mode === 'edit' ? 'No se puede cambiar.' : 'Opcional.'}>
            <Select
              value={unitId}
              disabled={mode === 'edit'}
              onChange={(e) => {
                setUnitId(e.target.value);
                setSuccess(false);
              }}
            >
              <option value="">Ninguna</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} ({u.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mínimo">
            <Input
              type="number"
              value={minValue}
              onChange={(e) => {
                setMinValue(e.target.value);
                setSuccess(false);
              }}
            />
          </Field>
          <Field
            label="Máximo"
            {...(fieldError['maxValue'] ? { error: fieldError['maxValue'] } : {})}
          >
            <Input
              type="number"
              value={maxValue}
              onChange={(e) => {
                setMaxValue(e.target.value);
                setSuccess(false);
              }}
            />
          </Field>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={isRequiredDefault}
          onChange={(e) => {
            setIsRequiredDefault(e.target.checked);
            setSuccess(false);
          }}
          className="h-4 w-4 rounded border-slate-300"
        />
        Obligatorio por defecto (una categoría puede anular esto por asignación)
      </label>

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

      {mode === 'create' && !numeric && (
        <p className="text-xs text-slate-500">
          {dataType === 'select' || dataType === 'multi_select'
            ? 'Después de crearlo, agrega las opciones seleccionables en la página del atributo.'
            : null}
        </p>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Atributo guardado.</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
          {mode === 'create' ? 'Crear atributo' : 'Guardar cambios'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => router.push('/attributes')}
        >
          {mode === 'create' ? 'Cancelar' : 'Volver a atributos'}
        </Button>
      </div>
    </form>
  );
}
