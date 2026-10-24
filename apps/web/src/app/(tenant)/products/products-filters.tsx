'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { VARIANT_STATUSES, VARIANT_STATUS_LABELS } from '../../../lib/types/products';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface ProductsFilterValues {
  q?: string | undefined;
  categoryId?: string | undefined;
  status?: string | undefined;
  stock?: 'with' | 'without' | undefined;
}

export interface CategoryOption {
  id: string;
  name: string;
}

const SEARCH_DEBOUNCE_MS = 350;

/**
 * The `/products` search + filter bar (OUI-004/OUI-006). The search box filters live as the owner
 * types — debounced (`SEARCH_DEBOUNCE_MS`) so a real request fires once typing pauses, never on
 * every keystroke and never waiting for Enter. A single "Filtro" button discloses the three real
 * filters (`categoryId`, `status`, `stock`) — replacing the old always-visible status/category chip
 * rows — and the panel closes itself the moment a click lands outside it, not only on a second
 * press of the same button. Every control navigates with new search params; the server component
 * re-fetches (no client-side data fetching of its own, the same pattern `SalesFilters` established).
 */
export function ProductsFilters({
  initial,
  categories,
  showAll = false,
}: {
  initial: ProductsFilterValues;
  categories: CategoryOption[];
  /** The "Ver todos" view survives a search/filter change. */
  showAll?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [q, setQ] = useState(initial.q ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  // Kept empty (not defaulted to 'active') so unrelated filter changes below don't start stamping
  // `&status=active` onto every navigation — the Select's `value` below is what actually shows the
  // untouched default as "Activo" to the owner.
  const [status, setStatus] = useState(initial.status ?? '');
  const [stock, setStock] = useState(initial.stock ?? '');
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const skipNextDebounce = useRef(true);

  // The URL is the truth for the panel: when a filter changes from outside (an active-filter chip's ×,
  // the browser back button) the controls follow it, so the panel and the count never disagree.
  useEffect(() => setCategoryId(initial.categoryId ?? ''), [initial.categoryId]);
  useEffect(() => setStatus(initial.status ?? ''), [initial.status]);
  useEffect(() => setStock(initial.stock ?? ''), [initial.stock]);

  function apply(next: ProductsFilterValues = {}): void {
    const params = new URLSearchParams();
    const nextQ = 'q' in next ? next.q : q;
    const nextCategoryId = 'categoryId' in next ? next.categoryId : categoryId;
    const nextStatus = 'status' in next ? next.status : status;
    const nextStock = 'stock' in next ? next.stock : stock;
    if (nextQ) params.set('q', nextQ);
    if (nextCategoryId) params.set('categoryId', nextCategoryId);
    if (nextStatus) params.set('status', nextStatus);
    if (nextStock) params.set('stock', nextStock);
    if (showAll) params.set('all', '1');
    router.push(`/products${params.toString() ? `?${params}` : ''}`, { scroll: false });
  }

  // Live search: debounced so a pause in typing (not every keystroke) triggers the real navigation.
  // Skips the very first render so mounting with an existing `?q=` never re-fires it immediately.
  useEffect(() => {
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const timer = setTimeout(() => {
      apply({ q: q.trim() || undefined });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // apply() reads the other filters from state at call time; re-running this effect only on `q`
    // changing is the intended debounce (this project's eslint config has no react-hooks rule).
  }, [q]);

  // Close the filter panel on any click outside it — never requiring a second press of "Filtro".
  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [panelOpen]);

  function clearFilters(): void {
    setCategoryId('');
    setStatus('');
    setStock('');
    apply({ categoryId: undefined, status: undefined, stock: undefined });
  }

  // The count is exactly the filters the page applies (the same ones its chips show), taken from the
  // URL values the server rendered with — never from half-edited local state: Estado counts unless it
  // is 'Todos', plus Categoría and Stock when set. (The search text is the search box, not a filter.)
  const activeFilterCount = [initial.categoryId, initial.status === 'all' ? '' : 'active', initial.stock].filter(Boolean).length;
  const hasFilter = activeFilterCount > 0;

  return (
    <div className="flex flex-wrap items-start gap-2">
      <Input
        type="search"
        aria-label="Buscar productos"
        placeholder="Buscar por nombre o código"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="min-w-[16rem] flex-1"
      />

      <div ref={panelRef} className="relative">
        <Button type="button" variant={hasFilter ? 'primary' : 'secondary'} onClick={() => setPanelOpen((v) => !v)}>
          Filtro{hasFilter ? ` (${activeFilterCount})` : ''}
        </Button>

        {panelOpen && (
          <div className="absolute right-0 z-10 mt-2 flex w-72 flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-lg">
            <Field label="Categoría">
              <Select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  apply({ categoryId: e.target.value || undefined });
                }}
              >
                <option value="">Todas</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Estado" help="Por defecto se ocultan las variantes desactivadas.">
              <Select
                value={status || 'active'}
                onChange={(e) => {
                  setStatus(e.target.value);
                  apply({ status: e.target.value || undefined });
                }}
              >
                {VARIANT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {VARIANT_STATUS_LABELS[s]}
                  </option>
                ))}
                <option value="all">Todos (incluye desactivadas)</option>
              </Select>
            </Field>

            <Field label="Stock" help="Con Stock = más de 1 unidad disponible. Sin Stock = 0.">
              <Select
                value={stock}
                onChange={(e) => {
                  const next = (e.target.value || undefined) as 'with' | 'without' | undefined;
                  setStock(next ?? '');
                  apply({ stock: next });
                }}
              >
                <option value="">Todos</option>
                <option value="with">Con Stock</option>
                <option value="without">Sin Stock</option>
              </Select>
            </Field>

            {hasFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="self-start text-xs font-medium text-slate-500 hover:underline"
              >
                Quitar filtros
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
