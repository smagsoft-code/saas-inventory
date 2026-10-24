'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../../lib/api/errors';
import { Alert } from '../../../../../components/ui/alert';
import { Button, buttonClasses } from '../../../../../components/ui/button';
import { Field } from '../../../../../components/ui/field';
import { Input, Select } from '../../../../../components/ui/input';
import { Modal } from '../../../../../components/ui/modal';
import { Table, TBody, TD, TH, THead, TR } from '../../../../../components/ui/table';

const BASE_PATH = '/api/v1/inventory/receipts/bulk';

export interface WarehouseOption {
  id: string;
  name: string;
}
export interface LocationOption {
  id: string;
  warehouseId: string;
  name: string;
}

interface PreviewRow {
  rowNumber: number;
  code: string;
  productName?: string;
  quantity?: number;
  unitCost?: number;
  reason: string;
  errors: string[];
}
interface Preview {
  rows: PreviewRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  totalQuantity: number;
}
interface Result {
  loadedRows: number;
  totalQuantity: number;
}

function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * "Carga masiva de stock" — sucursal + almacén + (opcional) fecha del movimiento + un Excel de
 * Código / Cantidad / Costo unitario / Motivo. Dos pasos contra el backend: `/preview` (no escribe
 * nada; devuelve cada fila con sus errores) y la confirmación, que es todo-o-nada y lleva un
 * `Idempotency-Key`: la misma clave se reutiliza mientras no cambie el archivo, el almacén ni la
 * fecha, de modo que un doble clic o un reintento de red no carga el stock dos veces.
 */
export function BulkStockForm({
  warehouses,
  locations,
}: {
  warehouses: WarehouseOption[];
  locations: LocationOption[];
}): React.JSX.Element {
  const today = useMemo(todayLocal, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // One key per attempt: kept across retries of the same payload, renewed when the payload changes.
  const idempotencyKey = useRef<string>(newKey());

  const locationsInWarehouse = useMemo(() => locations.filter((l) => l.warehouseId === warehouseId), [locations, warehouseId]);
  const pastDate = occurredOn !== '' && occurredOn < today;

  function payloadChanged(): void {
    setPreview(null);
    setError(null);
    idempotencyKey.current = newKey();
  }

  function buildForm(): FormData {
    const form = new FormData();
    form.append('locationId', locationId);
    if (occurredOn) form.append('occurredOn', occurredOn);
    form.append('file', file as File);
    return form;
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!warehouseId) next['warehouseId'] = 'Elige una sucursal.';
    if (warehouseId && !locationId) next['locationId'] = 'Elige un almacén.';
    if (occurredOn && occurredOn > today) next['occurredOn'] = 'La fecha no puede ser futura.';
    if (!file) next['file'] = 'Elige el archivo de Excel (.xlsx).';
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function onCheck(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (checking || !validate()) return;
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await apiFetch<Preview>(`${BASE_PATH}/preview`, { method: 'POST', body: buildForm() }));
    } catch (err) {
      setError(isApiError(err) && err.status === 403 ? 'No tienes autorización para cargar stock en este almacén.' : httpErrorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function onConfirm(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const done = await apiFetch<Result>(BASE_PATH, {
        method: 'POST',
        body: buildForm(),
        headers: { 'Idempotency-Key': idempotencyKey.current },
      });
      setConfirmOpen(false);
      setResult(done);
    } catch (err) {
      setConfirmOpen(false);
      setPreview(null);
      if (isApiError(err) && err.status === 403) setError('No tienes autorización para cargar stock en este almacén.');
      else if (isApiError(err) && err.status === 422) setError(`${err.message} Vuelve a revisar el archivo.`);
      else setError(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function startAnother(): void {
    setResult(null);
    setPreview(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    idempotencyKey.current = newKey();
  }

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);
  const selectedLocation = locations.find((l) => l.id === locationId);

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => void onCheck(e)} noValidate className="flex w-full max-w-2xl flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sucursal" required {...(fieldError['warehouseId'] ? { error: fieldError['warehouseId'] } : {})}>
            <Select
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setLocationId('');
                payloadChanged();
              }}
            >
              <option value="">Elegir una sucursal…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Almacén" required {...(fieldError['locationId'] ? { error: fieldError['locationId'] } : {})}>
            <Select
              value={locationId}
              disabled={!warehouseId}
              onChange={(e) => {
                setLocationId(e.target.value);
                payloadChanged();
              }}
            >
              <option value="">{warehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}</option>
              {locationsInWarehouse.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Fecha del movimiento"
          help="Una sola fecha para todo el archivo. Por defecto es hoy; no puede ser futura. Una fecha anterior cambia el historial del Kardex desde ese día."
          {...(fieldError['occurredOn'] ? { error: fieldError['occurredOn'] } : {})}
        >
          <Input
            type="date"
            max={today}
            value={occurredOn}
            className="sm:w-48"
            onChange={(e) => {
              setOccurredOn(e.target.value);
              payloadChanged();
            }}
          />
        </Field>

        {/* Above the file picker: grab the template first, then fill it and pick it below. */}
        <a href={`${BASE_PATH}/template`} className={buttonClasses('success', 'md', 'w-fit')}>
          Descargar plantilla (.xlsx)
        </a>

        <Field
          label="Archivo de Excel"
          required
          hint="Columnas: Código, Cantidad, Costo unitario y Motivo. Máximo 500 filas."
          {...(fieldError['file'] ? { error: fieldError['file'] } : {})}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              payloadChanged();
            }}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={checking} className="w-fit">
            Revisar archivo
          </Button>
        </div>
      </form>

      {preview && (
        <section className="flex flex-col gap-3" aria-label="Resultado de la revisión">
          {preview.invalidRows > 0 ? (
            <Alert tone="error">
              {preview.invalidRows} de {preview.totalRows} fila{preview.totalRows === 1 ? '' : 's'} con errores. No se cargará nada
              hasta que corrijas el archivo y lo vuelvas a revisar.
            </Alert>
          ) : (
            <Alert tone="success">
              Archivo correcto: {preview.validRows} producto{preview.validRows === 1 ? '' : 's'}, {preview.totalQuantity} unidades en total.
            </Alert>
          )}
          <Table>
            <THead>
              <TR>
                <TH>Fila</TH>
                <TH>Código</TH>
                <TH>Producto</TH>
                <TH className="text-right">Cantidad</TH>
                <TH className="text-right">Costo unitario</TH>
                <TH>Motivo</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {preview.rows.map((row) => (
                <TR key={row.rowNumber} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                  <TD>{row.rowNumber}</TD>
                  <TD>{row.code}</TD>
                  <TD>{row.productName ?? '—'}</TD>
                  <TD className="text-right">{row.quantity ?? '—'}</TD>
                  <TD className="text-right">{row.unitCost ?? '—'}</TD>
                  <TD>{row.reason || '—'}</TD>
                  <TD>
                    {row.errors.length === 0 ? (
                      <span className="text-emerald-700">Correcta</span>
                    ) : (
                      <ul className="list-disc pl-4 text-red-700">
                        {row.errors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {preview.invalidRows === 0 && (
            <div>
              <Button type="button" onClick={() => setConfirmOpen(true)} className="w-fit">
                Cargar {preview.validRows} producto{preview.validRows === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </section>
      )}

      <Modal
        open={confirmOpen && preview !== null}
        onClose={() => (submitting ? undefined : setConfirmOpen(false))}
        title={`¿Se cargarán ${preview?.validRows ?? 0} productos?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={submitting} onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" loading={submitting} onClick={() => void onConfirm()}>
              Confirmar carga
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-slate-700">
          <p>
            {preview?.totalQuantity ?? 0} unidades en total hacia <strong>{selectedWarehouse?.name}</strong> ·{' '}
            <strong>{selectedLocation?.name}</strong>.
          </p>
          {pastDate && (
            <Alert tone="warning">
              Esta carga se registrará con fecha {formatDay(occurredOn)} y cambiará el historial del Kardex desde esa fecha.
            </Alert>
          )}
        </div>
      </Modal>

      <Modal
        open={result !== null}
        onClose={startAnother}
        title="Carga completada"
        footer={
          <div className="flex justify-end gap-2">
            <Link href="/inventory" className={buttonClasses('ghost')}>
              Ir a inventario
            </Link>
            <Button type="button" onClick={startAnother}>
              Cargar otro archivo
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          Se cargaron <strong>{result?.loadedRows}</strong> producto{result?.loadedRows === 1 ? '' : 's'} ({result?.totalQuantity} unidades).
        </p>
      </Modal>
    </div>
  );
}
