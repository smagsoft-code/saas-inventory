'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { QR_STATUSES, type QrStatus } from '../../../lib/types/qr';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

export interface QrFilterValues {
  q?: string | undefined;
  categoryId?: string | undefined;
  status?: QrStatus | undefined;
}

export interface CategoryOption {
  id: string;
  name: string;
}

const SEARCH_DEBOUNCE_MS = 350;

const QR_STATUS_LABELS: Record<QrStatus, string> = { active: 'Activo', revoked: 'Revocado' };

/**
 * The `/qr` search + filter bar — same visual/functional pattern `ProductsFilters` established on
 * `/products` (debounced live search, a single "Filtro" button disclosing the real filters, panel
 * closes on any outside click), kept as its own component rather than a further-generalized
 * `ProductsFilters` because `status` here means something genuinely different: the QR code's own
 * lifecycle (`active`/`revoked`, `QR_STATUSES`), not a product variant's. `categoryId` is the one
 * field that really is the same concept as Products' (a product's category), reused as-is. No
 * stock filter — stock is a product/inventory concept with nothing to do with which QR codes exist.
 */
export function QrFilters({
  initial,
  categories,
}: {
  initial: QrFilterValues;
  categories: CategoryOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [q, setQ] = useState(initial.q ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [status, setStatus] = useState<QrStatus | ''>(initial.status ?? '');
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const skipNextDebounce = useRef(true);

  function apply(next: QrFilterValues = {}): void {
    const params = new URLSearchParams();
    const nextQ = 'q' in next ? next.q : q;
    const nextCategoryId = 'categoryId' in next ? next.categoryId : categoryId;
    const nextStatus = 'status' in next ? next.status : status;
    if (nextQ) params.set('q', nextQ);
    if (nextCategoryId) params.set('categoryId', nextCategoryId);
    if (nextStatus) params.set('status', nextStatus);
    router.push(`/qr${params.toString() ? `?${params}` : ''}`);
  }

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
    apply({ categoryId: undefined, status: undefined });
  }

  const activeFilterCount = [categoryId, status].filter(Boolean).length;
  const hasFilter = activeFilterCount > 0;

  return (
    <div className="flex flex-wrap items-start gap-2">
      <Input
        type="search"
        aria-label="Buscar por producto, variante o código"
        placeholder="Buscar por producto, variante o código"
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

            <Field label="Estado">
              <Select
                value={status}
                onChange={(e) => {
                  const next = (e.target.value || undefined) as QrStatus | undefined;
                  setStatus(next ?? '');
                  apply({ status: next });
                }}
              >
                <option value="">Todos</option>
                {QR_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {QR_STATUS_LABELS[s]}
                  </option>
                ))}
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
