/**
 * Mirrors `apps/api/src/catalog/products/dto/*` — the real product + variant contract
 * (ADR-0017 / ADR-0026 / ADR-0028). Kept local to the frontend, the same convention as
 * `lib/types/catalog.ts` / `lib/types/inventory.ts`.
 *
 * Endpoints (all tenant-scoped — `tenantId` is resolved server-side, never sent):
 *  - `GET/POST /api/v1/products` · `GET/PATCH /api/v1/products/:id`
 *  - `GET/POST /api/v1/products/:id/variants` · `GET/PATCH /api/v1/products/:id/variants/:variantId`
 *
 * There is **no DELETE** on either resource — a product is `discontinued`, a variant is
 * `discontinued` (PATCH status). Variants are reachable **only** per product — there is no
 * tenant-wide `GET /variants` (`GAP-VARIANT-LIST`). Dynamic `attributes` live as a governed JSONB
 * blob on the product/variant row itself, keyed by the attribute definition `code` — there is no
 * separate attribute-value endpoint (ADR-0026, `AttributeValidationService`).
 */

// --- products ---------------------------------------------------------------------------------

export const PRODUCT_STATUSES = ['draft', 'active', 'discontinued'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  discontinued: 'Discontinued',
};

/** `GET /products` list item / `GET /products/:id` — `ProductResponseDto`. No SKU on the product
 * (SKU is a variant field). `attributes` is the PRODUCT-scope governed JSONB. */
export interface Product {
  id: string;
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  name: string;
  description?: string;
  status: string;
  warrantyMonths?: number;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `POST /products` body — `CreateProductDto`. `defaultVariant` is **mandatory** (ADR-0017 —
 * every product is created with exactly one variant). `brandId`/`supplierId` are accepted by the
 * DTO but there is no endpoint to list brands/suppliers (`GAP-BRAND-SUPPLIER-LIST`), so the form
 * does not offer selectors for them. */
export interface CreateProductInput {
  name: string;
  description?: string;
  categoryId?: string;
  warrantyMonths?: number;
  attributes?: Record<string, unknown>;
  defaultVariant: VariantFieldsInput;
}

/** `PATCH /products/:id` body — `UpdateProductDto`. Every field optional; omit to leave
 * unchanged. `attributes`, when sent, **replaces** the full PRODUCT-scope object and is
 * re-validated against the effective (possibly new) `categoryId` in the same request. */
export interface UpdateProductInput {
  name?: string;
  description?: string;
  categoryId?: string;
  status?: ProductStatus;
  warrantyMonths?: number;
  attributes?: Record<string, unknown>;
}

// --- variants --------------------------------------------------------------------------------

export const VARIANT_STATUSES = ['active', 'discontinued'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const VARIANT_STATUS_LABELS: Record<VariantStatus, string> = {
  active: 'Active',
  discontinued: 'Discontinued',
};

/** `GET /products/:id/variants` item / `:variantId` — `VariantResponseDto`. `minPrice` is present
 * only for a caller holding `pricing.floor.view`; `cost` only with `pricing.cost.view` (ADR-0028 —
 * omitted entirely, never null/masked). */
export interface Variant {
  id: string;
  productId: string;
  sku: string;
  barcode?: string;
  unit: string;
  maxPrice: number;
  basePrice: number;
  minPrice?: number;
  cost?: number;
  status: string;
  isSerialized: boolean;
  isLotTracked: boolean;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `POST /products/:id/variants` body — `VariantFieldsDto` (also embedded as `defaultVariant` on
 * `CreateProductDto`). `sku`, `maxPrice`, `basePrice`, `minPrice` are required; the three prices
 * must satisfy `minPrice <= basePrice <= maxPrice`. */
export interface VariantFieldsInput {
  sku: string;
  barcode?: string;
  unit?: string;
  maxPrice: number;
  basePrice: number;
  minPrice: number;
  cost?: number;
  isSerialized?: boolean;
  isLotTracked?: boolean;
  attributes?: Record<string, unknown>;
}

/** `PATCH /products/:id/variants/:variantId` body — `UpdateVariantDto`. **`sku`,
 * `isSerialized` and `isLotTracked` are not in this DTO** — they are immutable after creation.
 * `status` toggles `active`/`discontinued`. */
export interface UpdateVariantInput {
  barcode?: string;
  unit?: string;
  maxPrice?: number;
  basePrice?: number;
  minPrice?: number;
  cost?: number;
  status?: VariantStatus;
  attributes?: Record<string, unknown>;
}

// --- pricing helper --------------------------------------------------------------------------

/** The DB CHECK the backend also enforces (`assertPriceTierValues`). */
export function pricesAreOrdered(minPrice: number, basePrice: number, maxPrice: number): boolean {
  return minPrice <= basePrice && basePrice <= maxPrice;
}
