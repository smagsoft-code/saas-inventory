'use client';

import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { Input } from '../../../../components/ui/input';

/** One sellable-from-here variant: what the search returns for a product name or code. */
export interface VariantHit {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  quantityAvailable: number;
}

const DEBOUNCE_MS = 300;

/** `GET /inventory/products-in-stock/variants` (`inventory.view`) — products/variants with stock
 * available at `locationId` whose name or code contains `q` (bounded to a handful of hits). */
export async function searchVariantsInStock(locationId: string, q: string): Promise<VariantHit[]> {
  return apiFetch<VariantHit[]>('/api/v1/inventory/products-in-stock/variants', {
    query: { locationId, q },
  });
}

/**
 * The "Producto" search box of a transfer line — same behaviour as the product search of the sale
 * cart: type a name or a code, the list narrows after a short pause, pick a hit. It replaces the
 * old drop-down; hits are limited to what can actually leave the chosen origin. `Field` wires its
 * `id`/`aria-*` props onto this component, which forwards them to the input.
 */
export function TransferProductSearch({
  locationId,
  selectedLabel,
  placeholder,
  disabled,
  onPick,
  ...fieldProps
}: {
  locationId: string;
  /** What the line already holds (shown while the user is not typing). */
  selectedLabel: string;
  placeholder: string;
  disabled: boolean;
  onPick: (hit: VariantHit) => void;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'disabled' | 'placeholder' | 'type'
>): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VariantHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!editing || !q || !locationId) {
      setResults([]);
      setSearching(false);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchVariantsInStock(locationId, q)
        .then((hits) => {
          if (!cancelled) {
            setResults(hits);
            setSearched(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setSearched(true);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, editing, locationId]);

  return (
    <div className="flex flex-col gap-1">
      <Input
        {...fieldProps}
        type="search"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={editing ? query : selectedLabel}
        onFocus={() => {
          if (!editing) {
            setEditing(true);
            setQuery('');
          }
        }}
        onChange={(event) => {
          setEditing(true);
          setQuery(event.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          setResults([]);
        }}
      />
      {editing && searching && <p className="text-xs text-slate-500">Buscando…</p>}
      {editing && !searching && searched && results.length === 0 && (
        <p className="text-sm text-slate-500">
          Ningún producto con stock coincide con esa búsqueda.
        </p>
      )}
      {editing && results.length > 0 && (
        <ul
          className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200 bg-white"
          role="listbox"
          aria-label="Resultados de búsqueda"
        >
          {results.map((hit) => (
            <li key={hit.variantId} role="option" aria-selected="false">
              {/* mouse-down is cancelled so the input keeps focus long enough for the click to land */}
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setEditing(false);
                  setResults([]);
                  onPick(hit);
                }}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="truncate text-sm font-medium text-slate-900">
                  {hit.productName}
                </span>
                <span className="text-xs text-slate-500">
                  {hit.sku} · {hit.quantityAvailable} disp.
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
