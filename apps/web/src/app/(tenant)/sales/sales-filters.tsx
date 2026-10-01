'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type Customer,
} from '../../../lib/types/sales';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface SalesFilterValues {
  status?: string | undefined;
  documentType?: string | undefined;
  customerId?: string | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}

/**
 * The sales-history filter bar. Every control maps to a real `GET /api/v1/orders` query param
 * (`status`, `documentType`, `customerId`, `createdFrom`, `createdTo`) — there is no text search
 * or sort on that endpoint (`GAP-SEARCH` / `GAP-SORT`). The customer picker reuses
 * `GET /api/v1/customers?q=` (the only `q`-capable list). Applying a filter navigates with new
 * search params (`page` is reset); the server component re-fetches.
 *
 * Date range: the inputs are calendar dates; they are sent as a UTC day boundary
 * (`T00:00:00.000Z` … `T23:59:59.999Z`). Tenant-timezone-correct ranges are `GAP-HOME-DATE-TZ` /
 * `GAP-TZ-VISIBILITY`; inclusive/exclusive boundary semantics are `GAP-DATE-SEMANTICS`.
 */
export function SalesFilters({
  initial,
  customerName,
  canSearchCustomers,
}: {
  initial: SalesFilterValues;
  customerName?: string | undefined;
  canSearchCustomers: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [status, setStatus] = useState(initial.status ?? '');
  const [documentType, setDocumentType] = useState(initial.documentType ?? '');
  const [customerId, setCustomerId] = useState(initial.customerId ?? '');
  const [customerLabel, setCustomerLabel] = useState(customerName ?? '');
  const [from, setFrom] = useState(initial.createdFrom?.slice(0, 10) ?? '');
  const [to, setTo] = useState(initial.createdTo?.slice(0, 10) ?? '');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const liveRegion = useRef<HTMLParagraphElement>(null);

  function apply(next: SalesFilterValues): void {
    const params = new URLSearchParams();
    if (next.status) params.set('status', next.status);
    if (next.documentType) params.set('documentType', next.documentType);
    if (next.customerId) params.set('customerId', next.customerId);
    if (next.createdFrom) params.set('createdFrom', next.createdFrom);
    if (next.createdTo) params.set('createdTo', next.createdTo);
    router.push(`/sales${params.toString() ? `?${params}` : ''}`);
  }

  function current(overrides: SalesFilterValues = {}): SalesFilterValues {
    return {
      status: status || undefined,
      documentType: documentType || undefined,
      customerId: customerId || undefined,
      createdFrom: from ? `${from}T00:00:00.000Z` : undefined,
      createdTo: to ? `${to}T23:59:59.999Z` : undefined,
      ...overrides,
    };
  }

  async function searchCustomers(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const page = await apiFetch<{ data: Customer[] }>('/api/v1/customers', { query: { q, pageSize: 10 } });
      setResults(page.data);
      setSearched(true);
      if (liveRegion.current) {
        liveRegion.current.textContent = `${page.data.length} cliente${page.data.length === 1 ? '' : 's'} encontrado${page.data.length === 1 ? '' : 's'}`;
      }
    } catch (err) {
      setSearchError(httpErrorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  function chooseCustomer(customer: Customer): void {
    setCustomerId(customer.id);
    setCustomerLabel(customer.displayName);
    setPickerOpen(false);
    setResults([]);
    setSearched(false);
    setQuery('');
    apply(current({ customerId: customer.id }));
  }

  function clearCustomer(): void {
    setCustomerId('');
    setCustomerLabel('');
    apply(current({ customerId: undefined }));
  }

  const hasFilter = Boolean(status || documentType || customerId || from || to);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Estado">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              apply(current({ status: e.target.value || undefined }));
            }}
          >
            <option value="">Cualquier estado</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tipo de documento">
          <Select
            value={documentType}
            onChange={(e) => {
              setDocumentType(e.target.value);
              apply(current({ documentType: e.target.value || undefined }));
            }}
          >
            <option value="">Cualquier documento</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Creado desde" hint="Inicio del día UTC">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              apply(current({ createdFrom: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined }));
            }}
          />
        </Field>

        <Field label="Creado hasta" hint="Fin del día UTC">
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              apply(current({ createdTo: e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined }));
            }}
          />
        </Field>
      </div>

      {canSearchCustomers && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-700">Cliente</span>
            {customerId ? (
              <>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {customerLabel || customerId.slice(0, 8)}
                </span>
                <button type="button" onClick={clearCustomer} className="text-xs font-medium text-slate-500 hover:underline">
                  Quitar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="text-xs font-medium text-[#2F6FED] hover:underline"
              >
                {pickerOpen ? 'Cerrar' : 'Filtrar por cliente'}
              </button>
            )}
          </div>

          {pickerOpen && !customerId && (
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              <form onSubmit={searchCustomers} className="flex gap-2">
                <Input
                  type="search"
                  aria-label="Buscar clientes"
                  placeholder="Nombre, identificación tributaria, correo o teléfono"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button type="submit" size="sm" loading={searching} disabled={searching}>
                  Buscar
                </Button>
              </form>
              <p ref={liveRegion} className="sr-only" role="status" aria-live="polite" />
              {searchError && <p className="text-sm text-red-700">{searchError}</p>}
              {searched && results.length === 0 && !searchError && (
                <p className="text-sm text-slate-500">Ningún cliente coincide con esa búsqueda.</p>
              )}
              {results.length > 0 && (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {results.map((customer) => (
                    <li key={customer.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="text-sm">
                        <span className="font-medium text-slate-900">{customer.displayName}</span>
                        {customer.taxId && <span className="text-slate-500"> · {customer.taxId}</span>}
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => chooseCustomer(customer)}>
                        Seleccionar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {hasFilter && (
        <div>
          <button
            type="button"
            onClick={() => {
              setStatus('');
              setDocumentType('');
              setCustomerId('');
              setCustomerLabel('');
              setFrom('');
              setTo('');
              apply({});
            }}
            className="text-xs font-medium text-slate-500 hover:underline"
          >
            Quitar todos los filtros
          </button>
        </div>
      )}
    </div>
  );
}
