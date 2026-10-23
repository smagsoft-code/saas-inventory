'use client';

import { apiFetch } from '../lib/api/client';
import { SearchSelect } from './search-select';

const MAX_RESULTS = 8;

/** One search hit = one variant: its code and its product's name. `id`/`name` are the PRODUCT's, so the
 * callers that only care about the product keep working; `variantId` lets them preselect the variant. */
export interface ProductSearchHit {
  id: string;
  name: string;
  variantId: string;
  sku: string;
}

/**
 * Product search bar (Agregar stock, Ajustar existencias) — the variant-grain catalog search
 * (`GET /reports/product-catalog?q=`): `q` matches the product name, the variant's code (SKU) or its
 * barcode (case-insensitive substring), so typing a code finds it directly. Each result is one compact
 * row, `CODE  PRODUCT NAME`, with the code on the left. Only active products/variants are offered (a
 * discontinued one is never received into or adjusted). Controlled: the parent owns the selected product
 * (id + name).
 */
export function ProductSearchSelect({
  selected,
  onSelect,
  onClear,
}: {
  selected: { id: string; label: string } | null;
  onSelect: (hit: ProductSearchHit) => void;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <SearchSelect<ProductSearchHit>
      selected={selected}
      search={async (q) => {
        const page = await apiFetch<{ data: { productId: string; productName: string; variantId: string; sku: string }[] }>(
          '/api/v1/reports/product-catalog',
          { query: { q, status: 'active', productStatus: 'active', pageSize: 20 } },
        );
        return page.data
          .map((row) => ({ id: row.productId, name: row.productName, variantId: row.variantId, sku: row.sku }))
          .slice(0, MAX_RESULTS);
      }}
      getKey={(hit) => hit.variantId}
      renderOption={(hit) => (
        <>
          <span className="shrink-0 whitespace-nowrap font-mono text-xs text-slate-500">{hit.sku}</span>
          <span className="min-w-0 truncate font-medium text-slate-900">{hit.name}</span>
        </>
      )}
      onSelect={onSelect}
      onClear={onClear}
      compact
      ariaLabel="Buscar producto"
      listLabel="Productos encontrados"
      placeholder="Nombre, código o código de barras"
      emptyText="Ningún producto coincide con esa búsqueda."
      clearLabel="Cambiar"
    />
  );
}
