'use client';
import { HelpTip } from '../../../../components/ui/help-tip';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import {
  ATTRIBUTE_FIELD_PREFIX,
  MAPPABLE_IMPORT_FIELDS,
  STANDARD_IMPORT_FIELD_LABELS,
  columnMappingProblem,
  type MappingTemplate,
} from '../../../../lib/types/imports';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

interface Category {
  id: string;
  name: string;
}

/** One builder row: an Excel header plus its target. `attr` is a synthetic target that pairs with a
 * free-text attribute code — the final value written is `attr:<code>`. */
interface Row {
  key: string;
  header: string;
  target: string;
  attrCode: string;
}

const ATTR_TARGET = '__attr__';

function newRow(): Row {
  return { key: Math.random().toString(36).slice(2), header: '', target: 'sku', attrCode: '' };
}

function mappingToRows(mapping: Record<string, string>): Row[] {
  const rows = Object.entries(mapping).map(([header, target]) => {
    const isAttr = target.startsWith(ATTRIBUTE_FIELD_PREFIX);
    return {
      key: Math.random().toString(36).slice(2),
      header,
      target: isAttr ? ATTR_TARGET : target,
      attrCode: isAttr ? target.slice(ATTRIBUTE_FIELD_PREFIX.length) : '',
    };
  });
  return rows.length > 0 ? rows : [newRow()];
}

function rowsToMapping(rows: Row[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const row of rows) {
    const header = row.header.trim();
    if (!header) continue;
    const target = row.target === ATTR_TARGET ? `${ATTRIBUTE_FIELD_PREFIX}${row.attrCode.trim()}` : row.target;
    mapping[header] = target;
  }
  return mapping;
}

/**
 * Import mapping template CRUD (`S-IMP-TEMPLATES`). Every mutation goes through `apiFetch`:
 *  - `POST /api/v1/import-mapping-templates`           `{ name, categoryId?, columnMapping }`
 *  - `PATCH /api/v1/import-mapping-templates/:id`      partial
 *  - `DELETE /api/v1/import-mapping-templates/:id`     → 204
 * `columnMapping` is a `{ excelHeader: target }` map; `columnMappingProblem` mirrors the backend's
 * `assertValidColumnMapping` (must map a `sku`; targets are standard fields or `attr:<code>`) —
 * the backend re-validates. No `tenantId` / `createdBy` is ever sent.
 */
export function MappingTemplates({
  initialTemplates,
  categories,
}: {
  initialTemplates: MappingTemplate[];
  categories: Category[];
}): React.JSX.Element {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow()]);

  function resetForm(): void {
    setName('');
    setCategoryId('');
    setRows([newRow()]);
    setError(null);
  }

  function startCreate(): void {
    resetForm();
    setEditingId(null);
    setCreating(true);
  }

  function startEdit(template: MappingTemplate): void {
    setName(template.name);
    setCategoryId(template.categoryId ?? '');
    setRows(mappingToRows(template.columnMapping));
    setError(null);
    setCreating(false);
    setEditingId(template.id);
  }

  function cancelForm(): void {
    setCreating(false);
    setEditingId(null);
    resetForm();
  }

  function setRow(key: string, patch: Partial<Row>): void {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const mapping = rowsToMapping(rows);
  const problem = columnMappingProblem(mapping);
  const canSubmit = name.trim().length > 0 && problem === null && !busy;

  function reportError(err: unknown): void {
    setError(
      isApiError(err) && err.status === 403
        ? 'Necesitas el permiso de importación para administrar plantillas.'
        : httpErrorMessage(err),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await apiFetch(`/api/v1/import-mapping-templates/${editingId}`, {
          method: 'PATCH',
          body: { name: name.trim(), categoryId: categoryId || undefined, columnMapping: mapping },
        });
      } else {
        await apiFetch('/api/v1/import-mapping-templates', {
          method: 'POST',
          body: {
            name: name.trim(),
            ...(categoryId ? { categoryId } : {}),
            columnMapping: mapping,
          },
        });
      }
      cancelForm();
      router.refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/import-mapping-templates/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      router.refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  const categoryName = (id?: string): string => categories.find((c) => c.id === id)?.name ?? '—';
  const showForm = creating || editingId !== null;

  return (
    <div className="flex flex-col gap-4">
      {error && !showForm && <Alert tone="error">{error}</Alert>}

      {initialTemplates.length > 0 && (
        <Table>
          <THead>
            <TR>
              <TH>Nombre</TH>
              <TH>Categoría</TH>
              <TH className="text-right">Columnas</TH>
              <TH>Creada</TH>
              <TH className="w-0">
                <span className="sr-only">Acciones</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {initialTemplates.map((template) => (
              <TR key={template.id}>
                <TD className="font-medium">{template.name}</TD>
                <TD className="text-slate-500">{categoryName(template.categoryId)}</TD>
                <TD className="text-right text-slate-500">{Object.keys(template.columnMapping).length}</TD>
                <TD className="whitespace-nowrap text-slate-500">
                  {new Date(template.createdAt).toLocaleDateString('es')}
                </TD>
                <TD>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-sm font-medium text-slate-700 hover:underline disabled:text-slate-300"
                      disabled={busy}
                      onClick={() => startEdit(template)}
                    >
                      Editar
                    </button>
                    {confirmDeleteId === template.id ? (
                      <>
                        <button
                          type="button"
                          className="text-sm font-medium text-red-600 hover:underline disabled:text-red-300"
                          disabled={busy}
                          onClick={() => void remove(template.id)}
                        >
                          Confirmar eliminación
                        </button>
                        <button
                          type="button"
                          className="text-sm text-slate-500 hover:underline"
                          disabled={busy}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Mantener
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="text-sm font-medium text-red-600 hover:underline disabled:text-red-300"
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(template.id)}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {!showForm && (
        <div>
          <Button variant="secondary" onClick={startCreate}>
            Nueva plantilla
          </Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-slate-900">
                {editingId ? 'Editar plantilla' : 'Nueva plantilla'}
              </h2>
              {error && <Alert tone="error">{error}</Alert>}

              <Field label="Nombre" required className="max-w-sm">
                <Input
                  required
                  maxLength={200}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              {categories.length > 0 && (
                <Field label="Categoría" help="Vincula la plantilla al conjunto de atributos de una categoría. Opcional." className="max-w-sm">
                  <Select value={categoryId} disabled={busy} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Ninguna</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-slate-700">
                  <span className="flex items-center gap-1.5">
                    Columnas
                    <HelpTip>
                      Asigna cada encabezado de tu hoja de cálculo a un campo del producto. Una columna debe asignarse a «código».
                    </HelpTip>
                  </span>
                </legend>
                {rows.map((row) => (
                  <div key={row.key} className="flex flex-wrap items-end gap-2">
                    <Field label="Encabezado de Excel" className="w-48">
                      <Input
                        value={row.header}
                        disabled={busy}
                        onChange={(e) => setRow(row.key, { header: e.target.value })}
                      />
                    </Field>
                    <Field label="Se asigna a" className="w-44">
                      <Select
                        value={row.target}
                        disabled={busy}
                        onChange={(e) => setRow(row.key, { target: e.target.value })}
                      >
                        {MAPPABLE_IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {STANDARD_IMPORT_FIELD_LABELS[f]}
                          </option>
                        ))}
                        <option value={ATTR_TARGET}>atributo (attr:…)</option>
                      </Select>
                    </Field>
                    {row.target === ATTR_TARGET && (
                      <Field label="Código de atributo" className="w-40">
                        <Input
                          value={row.attrCode}
                          disabled={busy}
                          onChange={(e) => setRow(row.key, { attrCode: e.target.value })}
                        />
                      </Field>
                    )}
                    <button
                      type="button"
                      className="mb-2 text-sm font-medium text-slate-500 hover:underline disabled:text-slate-300"
                      disabled={busy || rows.length === 1}
                      onClick={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRows((cur) => [...cur, newRow()])}
                  >
                    Agregar columna
                  </Button>
                </div>
                {problem && <p className="text-xs text-red-600">{problem}</p>}
              </fieldset>

              <div className="flex gap-2">
                <Button type="submit" loading={busy} disabled={!canSubmit}>
                  {editingId ? 'Guardar plantilla' : 'Crear plantilla'}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={cancelForm}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {initialTemplates.length === 0 && !showForm && (
        <p className="text-sm text-slate-500">Aún no hay plantillas.</p>
      )}
    </div>
  );
}
