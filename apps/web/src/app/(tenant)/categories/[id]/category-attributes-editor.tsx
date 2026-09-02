'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { ATTRIBUTE_DATA_TYPE_LABELS } from '../../../../lib/types/catalog';
import type { AttributeDefinition, CategoryAttribute } from '../../../../lib/types/catalog';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';

/** One row of local editor state. `displayOrder` is the row index at save time. */
interface Assigned {
  attributeDefinitionId: string;
  isRequired: boolean;
}

/**
 * Manages `category_attributes` for one category — `GET /categories/:id/attributes` (read,
 * `categories.view`) and `PUT /categories/:id/attributes` (whole-set replace,
 * `catalog.attributes.manage`). `displayOrder` is derived from the on-screen order.
 *
 * This is the contract F17-05's product form consumes: for a product's category it will call the
 * same `GET /categories/:id/attributes` and render each definition by `dataType`.
 */
export function CategoryAttributesEditor({
  categoryId,
  assigned: initialAssigned,
  definitions,
  canManage,
}: {
  categoryId: string;
  assigned: CategoryAttribute[];
  definitions: AttributeDefinition[];
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const defById = useMemo(
    () => new Map(definitions.map((d) => [d.id, d])),
    [definitions],
  );
  const initial = useMemo<Assigned[]>(
    () =>
      [...initialAssigned]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((a) => ({ attributeDefinitionId: a.attributeDefinitionId, isRequired: a.isRequired })),
    [initialAssigned],
  );
  const [rows, setRows] = useState<Assigned[]>(initial);
  const [toAdd, setToAdd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const available = definitions.filter(
    (d) => d.status === 'active' && !rows.some((r) => r.attributeDefinitionId === d.id),
  );

  if (!canManage) {
    return initialAssigned.length === 0 ? (
      <p className="text-sm text-slate-500">No attributes assigned to this category.</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm">
        {[...initialAssigned]
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((a) => (
            <li key={a.attributeDefinitionId} className="text-slate-900">
              {a.name} <span className="text-slate-400">({ATTRIBUTE_DATA_TYPE_LABELS[a.dataType] ?? a.dataType})</span>
              {a.isRequired && <span className="ml-2 text-xs text-amber-700">required</span>}
            </li>
          ))}
      </ul>
    );
  }

  function move(index: number, delta: number): void {
    setRows((cur) => {
      const next = [...cur];
      const target = index + delta;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSuccess(false);
  }

  function remove(id: string): void {
    setRows((cur) => cur.filter((r) => r.attributeDefinitionId !== id));
    setSuccess(false);
  }

  function add(): void {
    if (!toAdd) return;
    setRows((cur) => [...cur, { attributeDefinitionId: toAdd, isRequired: false }]);
    setToAdd('');
    setSuccess(false);
  }

  function toggleRequired(id: string): void {
    setRows((cur) =>
      cur.map((r) => (r.attributeDefinitionId === id ? { ...r, isRequired: !r.isRequired } : r)),
    );
    setSuccess(false);
  }

  async function save(): Promise<void> {
    if (submitting || !dirty) return;
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/categories/${categoryId}/attributes`, {
        method: 'PUT',
        body: {
          entries: rows.map((r, index) => ({
            attributeDefinitionId: r.attributeDefinitionId,
            isRequired: r.isRequired,
            displayOrder: index,
          })),
        },
      });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'You need the manage-attributes permission to change category attributes.'
          : httpErrorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No attributes assigned. Products in this category will carry no dynamic attributes.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((row, index) => {
            const def = defById.get(row.attributeDefinitionId);
            return (
              <li
                key={row.attributeDefinitionId}
                className="flex flex-wrap items-center gap-3 px-3 py-2"
              >
                <span className="flex-1 text-sm">
                  <span className="font-medium text-slate-900">{def?.name ?? row.attributeDefinitionId}</span>{' '}
                  <Badge tone="neutral">
                    {def ? ATTRIBUTE_DATA_TYPE_LABELS[def.dataType] ?? def.dataType : '—'}
                  </Badge>
                  {def && def.appliesTo === 'variant' && (
                    <span className="ml-2 text-xs text-slate-400">per variant</span>
                  )}
                </span>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={row.isRequired}
                    onChange={() => toggleRequired(row.attributeDefinitionId)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Required
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${def?.name ?? 'attribute'} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${def?.name ?? 'attribute'} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(row.attributeDefinitionId)}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Add an attribute</span>
            <select
              value={toAdd}
              onChange={(e) => setToAdd(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 pr-8 text-sm"
            >
              <option value="">Choose an attribute…</option>
              {available.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({ATTRIBUTE_DATA_TYPE_LABELS[d.dataType] ?? d.dataType})
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="secondary" onClick={add} disabled={!toAdd}>
            Add
          </Button>
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Category attributes saved.</Alert>}

      <Button type="button" onClick={save} loading={submitting} disabled={!dirty} className="w-fit">
        Save attributes
      </Button>
    </div>
  );
}
