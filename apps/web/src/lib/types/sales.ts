/**
 * Mirrors the DTOs under `apps/api/src/sales/` — the real customers / cart / orders contract
 * (modules.md#sales, ADR-0022/0023/0028). Kept local to the frontend, the same convention as
 * `lib/types/catalog.ts` / `lib/types/inventory.ts`.
 *
 * Endpoints (all tenant-scoped — `tenantId` resolved server-side, never sent):
 *  - `GET/POST /api/v1/customers` · `GET/PATCH /api/v1/customers/:id`      (`sales.customers.view`/`.manage`)
 *  - `GET/POST/PATCH /api/v1/cart` · `POST/PATCH/DELETE /api/v1/cart/items[/:itemId]` (`sales.carts.manage`)
 *  - `GET /api/v1/orders` · `GET /api/v1/orders/:id`                       (`sales.orders.view`)
 *  - `POST /api/v1/orders` (+ `Idempotency-Key` header)                   (`sales.orders.create`)
 *
 * There is **no DELETE** on customers (soft-deleted). There is **no tenant-wide variant list**
 * (`GAP-VARIANT-LIST`) — cart lines are added Product → Variant. `minPrice` appears on cart/order
 * lines only for a caller with `pricing.floor.view`; `cost` is never in these DTOs (ADR-0028).
 */

// --- customers -------------------------------------------------------------------------------

export const CUSTOMER_TYPES = ['individual', 'business'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: 'Individual',
  business: 'Business',
};

export const CUSTOMER_STATUSES = ['active', 'inactive'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** The address keys `AddressDto` validates (all optional). */
export const CUSTOMER_ADDRESS_FIELDS = ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const;
export type CustomerAddressField = (typeof CUSTOMER_ADDRESS_FIELDS)[number];
export type CustomerAddress = Partial<Record<CustomerAddressField, string>>;

export const CUSTOMER_ADDRESS_FIELD_LABELS: Record<CustomerAddressField, string> = {
  line1: 'Address line 1',
  line2: 'Address line 2',
  city: 'City',
  state: 'State / province',
  postalCode: 'Postal code',
  country: 'Country',
};

/** `GET /customers` list item / `GET /customers/:id` — `CustomerResponseDto`. */
export interface Customer {
  id: string;
  type: string;
  displayName: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: Record<string, unknown>;
  status: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /customers` body — `CreateCustomerDto`. No `tenantId`/`status` (server-derived; starts
 * `active`). `taxId` is unique per tenant when present. */
export interface CreateCustomerInput {
  type: CustomerType;
  displayName: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: CustomerAddress;
  notes?: string;
}

/** `PATCH /customers/:id` body — `UpdateCustomerDto`. Every field optional. */
export interface UpdateCustomerInput {
  type?: CustomerType;
  displayName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: CustomerAddress;
  notes?: string;
  status?: CustomerStatus;
}

/** The commercial fields `OrdersService.assertCustomerCommercialData` requires before checkout —
 * a customer missing any of these makes `POST /orders` fail 422 (both document types, 012-A).
 * This is a UX mirror only; the backend re-checks. */
export function customerMissingCommercialData(customer: Pick<Customer, 'taxId' | 'email' | 'phone' | 'address'>): string[] {
  const missing: string[] = [];
  if (!customer.taxId) missing.push('tax id');
  if (!customer.email) missing.push('email');
  if (!customer.phone) missing.push('phone');
  if (!customer.address || Object.keys(customer.address).length === 0) missing.push('address');
  return missing;
}

// --- cart ------------------------------------------------------------------------------------

/** `CartItemResponseDto`. `unitPrice` = `negotiatedUnitPrice ?? live basePrice`. */
export interface CartItem {
  id: string;
  productVariantId: string;
  sku: string;
  productName: string;
  quantity: number;
  negotiatedUnitPrice?: number;
  unitPrice: number;
  lineSubtotal: number;
  maxPrice: number;
  basePrice: number;
  minPrice?: number;
  sellable: boolean;
  availableAtLocation: number;
}

/** `GET/POST/PATCH /cart` — `CartResponseDto`. A singular per-vendor resource; never addressed by
 * id in the URL. `subtotal` is server-computed. */
export interface Cart {
  id: string;
  status: string;
  locationId: string;
  customerId?: string;
  orderId?: string;
  items: CartItem[];
  subtotal: number;
  createdAt: string;
  updatedAt: string;
}

/** `POST /cart` body — `CreateCartDto` (get-or-create the caller's open cart). */
export interface CreateCartInput {
  locationId: string;
  customerId?: string;
}

/** `PATCH /cart` body — `UpdateCartDto`. */
export interface UpdateCartInput {
  customerId?: string;
  locationId?: string;
}

/** `POST /cart/items` body — `AddCartItemDto` (upsert: increments quantity if the variant is
 * already on the cart). */
export interface AddCartItemInput {
  productVariantId: string;
  quantity: number;
  negotiatedUnitPrice?: number;
}

/** `PATCH /cart/items/:itemId` body — `UpdateCartItemDto`. `quantity` is the new absolute value;
 * `negotiatedUnitPrice: null` clears a negotiation. */
export interface UpdateCartItemInput {
  quantity?: number;
  negotiatedUnitPrice?: number | null;
}

// --- orders ---------------------------------------------------------------------------------

export const ORDER_STATUSES = ['draft', 'pending', 'confirmed', 'fulfilled', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  confirmed: 'Confirmed',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

export function orderStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'confirmed':
    case 'fulfilled':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

export const DOCUMENT_TYPES = ['invoice', 'sales_note'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  sales_note: 'Sales note',
};

export interface OrderCustomerSnapshot {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: Record<string, unknown>;
}

/** `OrderItemResponseDto`. Prices are frozen at sale time. `minPrice` only with `pricing.floor.view`. */
export interface OrderItem {
  id: string;
  productVariantId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  maxPrice: number;
  basePrice: number;
  minPrice?: number;
  discountAmount: number;
  isExceptionalDiscount: boolean;
  lineTotal: number;
}

/** `GET /orders` list item / `GET /orders/:id` / `POST /orders` — `OrderResponseDto`. */
export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  documentType: string;
  invoiceStatus?: string;
  locationId: string;
  customerId?: string;
  customer: OrderCustomerSnapshot;
  items: OrderItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  placedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /orders` body — `CreateOrderDto`. Never sends `customerId`/`locationId`/`total`/`status`
 * (all derived from the cart + validated prices server-side). Requires an `Idempotency-Key` header. */
export interface CreateOrderInput {
  cartId: string;
  documentType: DocumentType;
}
