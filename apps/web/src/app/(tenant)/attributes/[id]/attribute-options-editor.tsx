'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { AttributeOption } from '../../../../lib/types/catalog';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

/**
 * Manages `attribute_options` for a `select` / `multi_select` definition —
 * `GET/POST /attribute-definitions/:id/options` and `PATCH .../options/:optionId`
 * (`catalog.attributes.manage`). No DELETE endpoint — an option is deactivated (`status`).
 * `code` is set once and never editable.
 */
export function AttributeOptionsEditor({
  definitionId,
  options,
  canManage,
}: {
  definitionId: string;
  options: AttributeOption[];
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const base = `/api/v1/attribute-definitions/${definitionId}/options`;
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const sorted = [...options].sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));

  function reportError(err: unknown): void {
    setError(
      isApiError(err) && err.status === 403
        ? 'Necesitas el permiso de gestión de atributos para cambiar las opciones.'
        : httpErrorMessage(err),
    );
  }

  async function addOption(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (adding || !newCode.trim() || !newLabel.trim()) return;
    setError(null);
    setAdding(true);
    try {
      await apiFetch(base, {
        method: 'POST',
        body: { code: newCode.trim(), label: newLabel.trim(), displayOrder: sorted.length },
      });
      setNewCode('');
      setNewLabel('');
      router.refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setAdding(false);
    }
  }

  async function toggleStatus(option: AttributeOption): Promise<void> {
    if (busyId) return;
    setError(null);
    setBusyId(option.id);
    try {
      await apiFetch(`${base}/${option.id}`, {
        method: 'PATCH',
        body: { status: option.status === 'active' ? 'inactive' : 'active' },
      });
      router.refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }

  if (!canManage) {
    return sorted.length === 0 ? (
      <p className="text-sm text-slate-500">No hay opciones definidas.</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm">
        {sorted.map((o) => (
          <li key={o.id} className="text-slate-900">
            {o.label} <span className="text-slate-400">({o.code})</span>
            {o.status !== 'active' && <span className="ml-2 text-xs text-slate-400">inactiva</span>}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sorted.length > 0 && (
        <Table>
          <THead>
            <TR>
              <TH>Etiqueta</TH>
              <TH>Código</TH>
              <TH>Estado</TH>
              <TH className="w-0"><span className="sr-only">Acciones</span></TH>
            </TR>
          </THead>
          <TBody>
            {sorted.map((o) => (
              <TR key={o.id}>
                <TD className="font-medium">{o.label}</TD>
                <TD className="text-slate-500"><code className="text-xs">{o.code}</code></TD>
                <TD>
                  <Badge tone={statusTone(o.status)}>
                    {o.status === 'active' ? 'Activa' : 'Inactiva'}
                  </Badge>
                </TD>
                <TD>
                  <button
                    type="button"
                    onClick={() => toggleStatus(o)}
                    disabled={busyId === o.id}
                    className="text-sm font-medium text-slate-700 hover:underline disabled:text-slate-400"
                  >
                    {o.status === 'active' ? 'Desactivar' : 'Activar'}
                  </button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <form onSubmit={addOption} noValidate className="flex flex-wrap items-end gap-3">
        <Field label="Código de la opción" required className="w-40">
          <Input required value={newCode} onChange={(e) => setNewCode(e.target.value)} />
        </Field>
        <Field label="Etiqueta" required className="w-48">
          <Input required value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" loading={adding} disabled={!newCode.trim() || !newLabel.trim()}>
          Agregar opción
        </Button>
      </form>

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
