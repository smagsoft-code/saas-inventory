'use client';

import { apiFetch } from '../lib/api/client';
import type { Customer } from '../lib/types/sales';
import { SearchSelect } from './search-select';

/**
 * Customer picker with live search — the same pattern the New Sale customer panel uses: a debounced
 * `GET /api/v1/customers?q=` (name, tax id, email or phone; server-side `ILIKE`, the only
 * `q`-capable customer list), pick one from the results. Controlled: the parent owns the selected
 * customer (id + label) so it can live in the URL. Mechanics live in `SearchSelect`.
 */
export function CustomerSearchSelect({
  selected,
  onSelect,
  onClear,
}: {
  selected: { id: string; label: string } | null;
  onSelect: (customer: Customer) => void;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <SearchSelect<Customer>
      selected={selected}
      search={async (q) => (await apiFetch<{ data: Customer[] }>('/api/v1/customers', { query: { q, pageSize: 10 } })).data}
      getKey={(customer) => customer.id}
      renderOption={(customer) => (
        <>
          <span className="font-medium text-slate-900">{customer.displayName}</span>
          {customer.taxId && <span className="text-xs text-slate-500">{customer.taxId}</span>}
        </>
      )}
      onSelect={onSelect}
      onClear={onClear}
      ariaLabel="Buscar cliente"
      listLabel="Clientes encontrados"
      placeholder="Nombre, identificación, correo o teléfono"
      emptyText="Ningún cliente coincide con esa búsqueda."
    />
  );
}
