'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { httpErrorMessage } from '../lib/api/errors';
import { Input } from './ui/input';

const SEARCH_DEBOUNCE_MS = 350;

/**
 * A search bar with live results — the shared mechanics behind every "pick one record by typing"
 * control (customers on the sales history, products on Agregar stock). A debounced server-side
 * search (the caller's `search`), a result list to pick from, and — once something is chosen — a
 * chip with a button to clear it. Stale responses are ignored (a newer keystroke wins). No local
 * filtering of a preloaded list: the backend does the matching.
 */
export function SearchSelect<T>({
  selected,
  search,
  getKey,
  renderOption,
  onSelect,
  onClear,
  ariaLabel,
  listLabel,
  placeholder,
  emptyText,
  clearLabel = 'Quitar',
  compact = false,
}: {
  selected: { id: string; label: string } | null;
  search: (query: string) => Promise<T[]>;
  getKey: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  onClear: () => void;
  ariaLabel: string;
  listLabel: string;
  placeholder: string;
  emptyText: string;
  clearLabel?: string;
  /** One tight row per option (e.g. `CODE  Name`) instead of stacked, roomy rows. */
  compact?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);
  // Always the latest `search` without making it an effect dependency (callers pass inline lambdas).
  const searchRef = useRef(search);
  searchRef.current = search;

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
      searchRef
        .current(q)
        .then((items) => {
          if (current !== requestId.current) return; // a newer keystroke superseded this response
          setResults(items);
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
        <span className="max-w-full truncate rounded-full bg-slate-900 px-3 py-1 text-sm font-medium text-white">{selected.label}</span>
        <button type="button" onClick={onClear} className="text-xs font-medium text-slate-500 hover:underline">
          {clearLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        type="search"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        className="h-10"
      />
      {query.trim() && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg" role="listbox" aria-label={listLabel}>
          {searching && <p className="px-3 py-2 text-sm text-slate-500">Buscando…</p>}
          {!searching && error && <p className="px-3 py-2 text-sm text-red-700">{error}</p>}
          {!searching && !error && searched && results.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">{emptyText}</p>}
          {!searching && results.length > 0 && (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {results.map((item) => (
                <li key={getKey(item)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={
                      compact
                        ? 'flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-sm leading-5 hover:bg-slate-50'
                        : 'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50'
                    }
                    onClick={() => {
                      setQuery('');
                      setResults([]);
                      onSelect(item);
                    }}
                  >
                    {renderOption(item)}
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
