'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { STANDARD_TEMPLATE_MAPPING, type ImportJob } from '../../../../lib/types/imports';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';

interface Option {
  id: string;
  name: string;
}
interface LocationOption {
  id: string;
  warehouseId: string;
  name: string;
}

/** `IMPORT_MAX_FILE_SIZE_BYTES` default (`import-file.service.ts`) — mirrored for an up-front client
 * check; the backend re-enforces it. */
const MAX_FILE_BYTES = 26_214_400;

type MappingSource = 'standard' | 'template';

/**
 * `POST /api/v1/imports` — `multipart/form-data` with a required `file` part plus optional text
 * fields (`mappingTemplateId` **or** `columnMapping` JSON, `defaultLocationId`, `duplicateHandlingMode`).
 * There is **no** `Idempotency-Key` on this endpoint. `tenantId` is never sent. A double submit is
 * blocked by `busy`. On success the backend returns the job; we go to its detail page where the
 * rest of the staged pipeline (validate → review → confirm) lives.
 *
 * `GAP-IMPORT-FILE-HEADERS`: no endpoint exposes the uploaded file's column headers, so the mapping
 * is picked up front — either a saved template, or the "standard layout" that mirrors the exact
 * header→field pairs `GET /imports/template` writes.
 */
export function ImportUploadForm({
  templates,
  warehouses,
  locations,
}: {
  templates: Option[];
  warehouses: Option[];
  locations: LocationOption[];
}): React.JSX.Element {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [mappingSource, setMappingSource] = useState<MappingSource>(templates.length > 0 ? 'template' : 'standard');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [defaultWarehouseId, setDefaultWarehouseId] = useState('');
  const [defaultLocationId, setDefaultLocationId] = useState('');
  const defaultLocationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === defaultWarehouseId),
    [locations, defaultWarehouseId],
  );
  function onDefaultWarehouseChange(nextWarehouseId: string): void {
    setDefaultWarehouseId(nextWarehouseId);
    setDefaultLocationId('');
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function onPickFile(next: File | null): void {
    setError(null);
    setFileError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!next.name.toLowerCase().endsWith('.xlsx')) {
      setFile(null);
      setFileError('Solo se aceptan archivos .xlsx.');
      return;
    }
    if (next.size <= 0) {
      setFile(null);
      setFileError('Ese archivo está vacío.');
      return;
    }
    if (next.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError('Ese archivo supera el límite de 25 MB.');
      return;
    }
    setFile(next);
  }

  const canSubmit =
    file !== null && !busy && (mappingSource === 'standard' || (mappingSource === 'template' && templateId !== ''));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || !file) {
      return;
    }
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.set('file', file);
    if (mappingSource === 'template') {
      form.set('mappingTemplateId', templateId);
    } else {
      form.set('columnMapping', JSON.stringify(STANDARD_TEMPLATE_MAPPING));
    }
    if (defaultLocationId) {
      form.set('defaultLocationId', defaultLocationId);
    }
    // A code that already exists is never touched: the row is rejected until its code is changed.
    form.set('duplicateHandlingMode', 'reject_on_duplicate');

    try {
      const job = await apiFetch<ImportJob>('/api/v1/imports', { method: 'POST', body: form });
      router.push(`/imports/${job.id}`);
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('No tienes autorización para iniciar esta importación.');
      } else {
        setError(httpErrorMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <Field label="Archivo Excel" required help="Una hoja de cálculo .xlsx, hasta 25 MB." error={fileError}>
            <Input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-700">Mapeo de columnas</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mappingSource"
                className="mt-1"
                checked={mappingSource === 'standard'}
                disabled={busy}
                onChange={() => setMappingSource('standard')}
              />
              <span>
                Completé la plantilla descargada
                <span className="block text-xs text-slate-500">
                  Usa el diseño estándar Código / Nombre / Precio… → campo.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mappingSource"
                className="mt-1"
                checked={mappingSource === 'template'}
                disabled={busy || templates.length === 0}
                onChange={() => setMappingSource('template')}
              />
              <span>
                Usar una plantilla de mapeo guardada
                {templates.length === 0 && (
                  <span className="block text-xs text-slate-500">
                    Aún no hay ninguna guardada —{' '}
                    <Link href="/imports/templates" className="font-medium underline-offset-2 hover:underline">
                      crea una en «Plantillas de mapeo»
                    </Link>
                    .
                  </span>
                )}
              </span>
            </label>
            {mappingSource === 'template' && templates.length > 0 && (
              <Field label="Plantilla de mapeo" required className="max-w-sm">
                <Select value={templateId} disabled={busy} onChange={(e) => setTemplateId(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <Field label="Sucursal predeterminada" help="Opcional — se usa para las filas que no traen su propia Sucursal en el Excel.">
            <Select value={defaultWarehouseId} disabled={busy} onChange={(e) => onDefaultWarehouseChange(e.target.value)}>
              <option value="">Sin sucursal predeterminada</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Almacén predeterminado"
            help="Se usa para las filas sin Almacén en el Excel (y sin Sucursal propia). Si una fila indica su Sucursal, manda la del Excel. Opcional."
          >
            <Select
              value={defaultLocationId}
              disabled={busy || !defaultWarehouseId}
              onChange={(e) => setDefaultLocationId(e.target.value)}
            >
              <option value="">
                {defaultWarehouseId
                  ? 'Sin predeterminado — cada fila con cantidad necesita su Sucursal y Almacén en el Excel'
                  : 'Elige primero una sucursal predeterminada'}
              </option>
              {defaultLocationsInWarehouse.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={!canSubmit}>
          Subir y continuar
        </Button>
      </div>
    </form>
  );
}
