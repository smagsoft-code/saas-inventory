'use client';

import { useId, type ReactNode } from 'react';
import type { AttributeField } from '../../../lib/catalog/product-attributes';
import type { AttributeOption } from '../../../lib/types/catalog';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

/** Turns a `datetime-local` input value (`YYYY-MM-DDTHH:mm`) into a full ISO string for the
 * backend, and an ISO string back into the input's expected local slice. */
export function toIsoFromLocal(local: string): string {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? local : date.toISOString();
}
function toLocalFromIso(iso: unknown): string {
  if (typeof iso !== 'string') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Renders one control per governed attribute (ADR-0026), by `dataType`. Values are stored in the
 * parent's `values` map keyed by the attribute `code`, in exactly the JSON shape the backend
 * validates (`number` → number, `select` → option code, `multi_select` → string[], …). No new
 * component library — `select` is a real `<select>`, `boolean`/`multi_select` real checkboxes.
 */
export function AttributeFields({
  legend,
  fields,
  optionsByDefinitionId,
  values,
  errors,
  onChange,
  disabled,
}: {
  legend: string;
  fields: AttributeField[];
  optionsByDefinitionId: Record<string, AttributeOption[]>;
  values: Record<string, unknown>;
  errors: Record<string, string>;
  onChange: (code: string, value: unknown) => void;
  disabled?: boolean;
}): React.JSX.Element | null {
  if (fields.length === 0) {
    return null;
  }
  return (
    <fieldset className="flex flex-col gap-4 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium text-slate-500">{legend}</legend>
      {fields.map((field) => (
        <AttributeControl
          key={field.code}
          field={field}
          options={optionsByDefinitionId[field.attributeDefinitionId] ?? []}
          value={values[field.code]}
          error={errors[field.code]}
          onChange={(value) => onChange(field.code, value)}
          disabled={disabled}
        />
      ))}
    </fieldset>
  );
}

/** Label + hint + error shell for the group controls (boolean / multi_select) that can't sit
 * inside `Field` (which wires a single form control). Mirrors `Field`'s look and a11y wiring. */
function GroupShell({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required: boolean;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
      <span className="flex items-baseline gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium text-slate-700">
          {label}
        </span>
        {required && (
          <span className="text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children(describedBy)}
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function AttributeControl({
  field,
  options,
  value,
  error,
  onChange,
  disabled,
}: {
  field: AttributeField;
  options: AttributeOption[];
  value: unknown;
  error?: string | undefined;
  onChange: (value: unknown) => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const hint = attributeHint(field);

  switch (field.dataType) {
    case 'boolean':
      return (
        <GroupShell label={field.name} required={field.isRequired} {...(error ? { error } : {})}>
          {(describedBy) => (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={value === true}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                onChange={(e) => onChange(e.target.checked)}
              />
              Sí
            </label>
          )}
        </GroupShell>
      );
    case 'number':
    case 'decimal':
      return (
        <Field label={field.name} required={field.isRequired} {...(error ? { error } : {})} {...(hint ? { hint } : {})}>
          <Input
            type="number"
            step={field.dataType === 'decimal' ? 'any' : '1'}
            {...(field.minValue !== undefined ? { min: field.minValue } : {})}
            {...(field.maxValue !== undefined ? { max: field.maxValue } : {})}
            value={typeof value === 'number' ? String(value) : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </Field>
      );
    case 'date':
      return (
        <Field label={field.name} required={field.isRequired} {...(error ? { error } : {})} {...(hint ? { hint } : {})}>
          <Input
            type="date"
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Field>
      );
    case 'datetime':
      return (
        <Field
          label={field.name}
          required={field.isRequired}
          {...(error ? { error } : {})}
          hint={hint ?? 'Se guarda en ISO-8601 (UTC).'}
        >
          <Input
            type="datetime-local"
            value={toLocalFromIso(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value ? toIsoFromLocal(e.target.value) : undefined)}
          />
        </Field>
      );
    case 'select':
      return (
        <Field label={field.name} required={field.isRequired} {...(error ? { error } : {})} {...(hint ? { hint } : {})}>
          <Select
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <option value="">{field.isRequired ? 'Elegir…' : 'Ninguno'}</option>
            {options.map((option) => (
              <option key={option.id} value={option.code}>
                {option.label}
              </option>
            ))}
            {typeof value === 'string' && value !== '' && !options.some((o) => o.code === value) && (
              <option value={value}>{value} (inactivo)</option>
            )}
          </Select>
        </Field>
      );
    case 'multi_select': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const codes = new Set(selected);
      const extras = selected.filter((code) => !options.some((o) => o.code === code));
      return (
        <GroupShell label={field.name} required={field.isRequired} {...(error ? { error } : {})}>
          {() => (
            <div className="flex flex-col gap-1.5">
              {options.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={codes.has(option.code)}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = new Set(codes);
                      if (e.target.checked) next.add(option.code);
                      else next.delete(option.code);
                      onChange([...next]);
                    }}
                  />
                  {option.label}
                </label>
              ))}
              {extras.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm text-slate-500">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked
                    disabled={disabled}
                    onChange={() => onChange(selected.filter((c) => c !== code))}
                  />
                  {code} (inactivo)
                </label>
              ))}
            </div>
          )}
        </GroupShell>
      );
    }
    default:
      return (
        <Field label={field.name} required={field.isRequired} {...(error ? { error } : {})} {...(hint ? { hint } : {})}>
          <Input
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Field>
      );
  }
}

function attributeHint(field: AttributeField): string | undefined {
  if (field.dataType === 'number' || field.dataType === 'decimal') {
    if (field.minValue !== undefined && field.maxValue !== undefined) {
      return `Entre ${field.minValue} y ${field.maxValue}.`;
    }
    if (field.minValue !== undefined) return `Mínimo ${field.minValue}.`;
    if (field.maxValue !== undefined) return `Máximo ${field.maxValue}.`;
  }
  return undefined;
}
