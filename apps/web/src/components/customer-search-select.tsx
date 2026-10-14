'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api/client';
import { httpErrorMessage } from '../lib/api/errors';
import type { Customer } from '../lib/types/sales';
import { Input } from './ui/input';

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Customer picker with live search — the same pattern the New Sale customer panel uses: a debounced
 * `GET /api/v1/customers?q=` (name, tax id, email or phone; server-side `ILIKE`, the only
 * `q`-capable customer list), pick one from the results. No local filtering of a preloaded list.
 * Controlled: the parent owns the selected customer (id + label) so it can live in the URL.
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      requestId.current += 1;
      setResults([]);
      setSearched(false);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    const current = ++requestId.current;
    const timer = setTimeout(() => {
      apiFetch<{ data: Customer[] }>('/api/v1/customers', { query: { q, pageSize: 10 } })
        .then((page) => {
          if (current !== requestId.current) return; // a newer keystroke superseded this response
          setResults(page.data);
          setError(null);
          setSearched(true);
        })
        .catch((err: unknown) => {
          if (current !== requestId.current) return;
          setResults([]);
          setError(httpErrorMessage(err));
        })
        .finally(() => {
          if (current === requestId.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  if (selected) {
    return (
      <div className="flex h-10 items-center gap-2">
        <span className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800">{selected.label}</span>
        <button type="button" onClick={onClear} className="text-xs font-medium text-slate-500 hover:underline">
          Quitar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        type="search"
        aria-label="Buscar cliente"
        placeholder="Nombre, identificación, correo o teléfono"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        className="h-10"
      />
      {query.trim() && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Clientes encontrados">
          {searching && <p className="px-3 py-2 text-sm text-slate-500">Buscando…</p>}
          {!searching && error && <p className="px-3 py-2 text-sm text-red-700">{error}</p>}
          {!searching && !error && searched && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-500">Ningún cliente coincide con esa búsqueda.</p>
          )}
          {!searching && results.length > 0 && (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {results.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setQuery('');
                      setResults([]);
                      onSelect(customer);
                    }}
                  >
                    <span className="font-medium text-slate-900">{customer.displayName}</span>
                    {customer.taxId && <span className="text-xs text-slate-500">{customer.taxId}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
