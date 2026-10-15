'use client';

import { apiFetch } from '../lib/api/client';
import { PRODUCT_STATUS_LABELS, type Product, type ProductStatus } from '../lib/types/products';
import { SearchSelect } from './search-select';

const MAX_RESULTS = 8;

/**
 * Product search bar — the same search the Productos window uses: `GET /api/v1/products?q=`
 * matches the product name, or any of its variants' SKU / barcode (case-insensitive substring, so a
 * scanned code typed by hand works too). Discontinued products are left out of the results; draft
 * ones are offered (receiving stock before activating a product is legitimate) and tagged.
 * Controlled: the parent owns the selected product (id + name).
 */
export function ProductSearchSelect({
  selected,
  onSelect,
  onClear,
}: {
  selected: { id: string; label: string } | null;
  onSelect: (product: Product) => void;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <SearchSelect<Product>
      selected={selected}
      search={async (q) => {
        const page = await apiFetch<{ data: Product[] }>('/api/v1/products', { query: { q, pageSize: 20 } });
        return page.data.filter((product) => product.status !== 'discontinued').slice(0, MAX_RESULTS);
      }}
      getKey={(product) => product.id}
      renderOption={(product) => (
        <>
          <span className="font-medium text-slate-900">{product.name}</span>
          {product.status !== 'active' && (
            <span className="text-xs text-slate-500">{PRODUCT_STATUS_LABELS[product.status as ProductStatus] ?? product.status}</span>
          )}
        </>
      )}
      onSelect={onSelect}
      onClear={onClear}
      ariaLabel="Buscar producto"
      listLabel="Productos encontrados"
      placeholder="Nombre, código o código de barras"
      emptyText="Ningún producto coincide con esa búsqueda."
      clearLabel="Cambiar"
    />
  );
}
