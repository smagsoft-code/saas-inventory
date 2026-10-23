import { apiFetch } from '../../../../lib/api/client';
import type { ProductImage, Variant } from '../../../../lib/types/products';
import type { QrResolveIdentity } from '../../../../lib/types/qr';

/** One search hit = one sellable *variant* (so the code can be shown under the name). `id` is the
 * parent product's id — what the cart flow then uses to list/choose its variants. */
export interface ProductSearchResult {
  id: string;
  variantId: string;
  name: string;
  /** The variant's code (SKU). */
  sku: string;
}

/**
 * Product search for the "Crear venta" cart modal — `GET /reports/product-catalog?q=` (variant
 * grain, `products.view`). `q` matches the product name, the variant's code (SKU) or its barcode
 * (case-insensitive substring), so typing a code finds it directly. Only active variants of ACTIVE
 * products are offered (`status` + `productStatus`): a discontinued product is never put in a
 * cart, and — given the sale's `locationId` — only variants with stock available there. Each hit carries its code so the picker can show it under the name. Bounded to a handful of
 * results; this is a picker, not the catalog list.
 */
export async function searchProducts(q: string, locationId?: string): Promise<ProductSearchResult[]> {
  const page = await apiFetch<{ data: { productId: string; productName: string; variantId: string; sku: string }[] }>(
    '/api/v1/reports/product-catalog',
    {
      query: {
        q,
        status: 'active',
        productStatus: 'active',
        // Only what can actually be sold: stock available at the sale's own almacén.
        ...(locationId ? { stock: 'available', locationId } : {}),
        pageSize: 8,
      },
    },
  );
  return page.data.map((row) => ({ id: row.productId, variantId: row.variantId, name: row.productName, sku: row.sku }));
}

/** `GET /products/:id/variants` — no tenant-wide variant list exists (`GAP-VARIANT-LIST`). */
export async function listVariants(productId: string): Promise<Variant[]> {
  return apiFetch<Variant[]>(`/api/v1/products/${productId}/variants`);
}

/** `GET /products/:id/variants/:variantId` — the full `VariantResponseDto` (price fields,
 * ADR-0028-gated `minPrice`/`cost`), used both by the QR flow and to refresh a single variant's
 * price after picking it from search results. */
export async function getVariant(productId: string, variantId: string): Promise<Variant> {
  return apiFetch<Variant>(`/api/v1/products/${productId}/variants/${variantId}`);
}

/**
 * `GET /inventory/balances?productVariantId=&locationId=` (`inventory.view`) — the same lookup
 * `TransferForm` already uses to preview stock before committing a line. Used here so the
 * product/variant picker can show "Stock disponible" and block a zero-stock variant *before* it
 * reaches the cart, not only after (the cart's own `availableAtLocation` is guidance, not a gate).
 */
export async function getStockAvailable(productVariantId: string, locationId: string): Promise<number> {
  const result = await apiFetch<{ data: { quantityAvailable: number }[] }>('/api/v1/inventory/balances', {
    query: { productVariantId, locationId, pageSize: 1 },
  });
  return result.data[0]?.quantityAvailable ?? 0;
}

/** `GET /products/:id/images` (`products.view`) — a plain array, not paginated. Used for the
 * cart line thumbnail; the caller only ever shows the first one. */
export async function listProductImages(productId: string): Promise<ProductImage[]> {
  return apiFetch<ProductImage[]>(`/api/v1/products/${productId}/images`);
}

/**
 * `GET /qr-codes/resolve/:code` — authenticated, no extra permission beyond login
 * (`QrCodesController.resolve`). Identity-only: the caller still fetches the variant through the
 * normal, permission-gated catalog endpoint (`getVariant`) for anything else, exactly as
 * mobile.md#qr-on-mobile specifies — this function never returns price or stock itself.
 */
export async function resolveQrCode(code: string): Promise<QrResolveIdentity> {
  return apiFetch<QrResolveIdentity>(`/api/v1/qr-codes/resolve/${encodeURIComponent(code)}`);
}
