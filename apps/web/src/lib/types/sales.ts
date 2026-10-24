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

/** Owner redesign: the identification document itself, replacing the old individual/business
 * distinction. Drives both the identification field's input format and its validation. */
export const CUSTOMER_TYPES = ['cedula', 'ruc', 'pasaporte'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  cedula: 'Cédula',
  ruc: 'RUC',
  pasaporte: 'Pasaporte',
};

/** Format hint shown next to the identification field, keyed by `type` (`IsTaxIdForType`,
 * migration 0037). */
export const CUSTOMER_TAX_ID_HINTS: Record<CustomerType, string> = {
  cedula: '10 números',
  ruc: '13 números',
  pasaporte: 'Números y letras',
};

export const CUSTOMER_STATUSES = ['active', 'inactive'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** `GET /customers` list item / `GET /customers/:id` — `CustomerResponseDto`. `address` is a
 * single free-form line (no structured sub-fields) — unrelated to `OrderCustomerSnapshot.address`,
 * which stays the order's own frozen jsonb shape. */
export interface Customer {
  id: string;
  type: string;
  firstName: string;
  lastName?: string;
  displayName: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /customers` body — `CreateCustomerDto`. No `tenantId`/`status` (server-derived; starts
 * `active`). `taxId` is required and format-checked against `type`; unique per tenant. */
export interface CreateCustomerInput {
  type: CustomerType;
  firstName: string;
  lastName: string;
  taxId: string;
  email?: string;
  phone?: string;
  address?: string;
}

/** `PATCH /customers/:id` body — `UpdateCustomerDto`. Every field optional. */
export interface UpdateCustomerInput {
  type?: CustomerType;
  firstName?: string;
  lastName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  status?: CustomerStatus;
}

/** The commercial fields `OrdersService.assertCustomerCommercialData` requires before checkout —
 * a customer missing any of these makes `POST /orders` fail 422 (both document types, 012-A).
 * This is a UX mirror only; the backend re-checks. */
export function customerMissingCommercialData(customer: Pick<Customer, 'taxId' | 'email' | 'phone' | 'address'>): string[] {
  const missing: string[] = [];
  if (!customer.taxId) missing.push('identificación tributaria');
  if (!customer.email) missing.push('correo electrónico');
  if (!customer.phone) missing.push('teléfono');
  if (!customer.address) missing.push('dirección');
  return missing;
}

// --- cart ------------------------------------------------------------------------------------

/** `CartItemResponseDto`. `unitPrice` = `negotiatedUnitPrice ?? live basePrice`. */
export interface CartItem {
  id: string;
  productVariantId: string;
  /** The parent product — lets the UI fetch its images (`GET /products/:productId/images`) for a
   * line thumbnail. */
  productId: string;
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

// GL-3: "Order" -> "Pedido" (decisión del owner, OUI-001).
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Borrador',
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  fulfilled: 'Completado',
  cancelled: 'Cancelado',
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

/** Owner redesign — split payment at checkout. Every `CreateOrderInput.payments` entry's
 * `amount` must sum exactly to the order total (checked server-side). */
export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  other: 'Otros',
};

/** `OrderPaymentResponseDto`. */
export interface OrderPayment {
  paymentMethod: string;
  amount: number;
}

export const DOCUMENT_TYPES = ['invoice', 'sales_note'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Factura',
  sales_note: 'Nota de venta',
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
  payments: OrderPayment[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  placedByUserId?: string;
  /** Seller (creator) display name — only on the `GET /orders` list. */
  placedByName?: string;
  /** Rolled-up `event_outbox` delivery status — only on the `GET /orders` list. */
  notificationStatus?: NotificationOverallStatus;
  createdAt: string;
  updatedAt: string;
}

/** `POST /orders` body — `CreateOrderDto`. Never sends `customerId`/`locationId`/`total`/`status`
 * (all derived from the cart + validated prices server-side). Requires an `Idempotency-Key`
 * header. No `payments` here — the owner's split-payment redesign asks for that at confirm
 * (`ConfirmOrderInput`), not at creation. */
export interface CreateOrderInput {
  cartId: string;
  documentType: DocumentType;
}

/** `POST /orders/:id/confirm` body — `ConfirmOrderDto`. Picked at the actual commit boundary, not
 * at `POST /orders` — see `CreateOrderInput`'s doc comment. */
export interface ConfirmOrderInput {
  payments: { paymentMethod: PaymentMethod; amount: number }[];
}

/** The order lifecycle the UI can drive (`OrdersService`): `pending → confirmed` (`POST /orders/:id/confirm`,
 * `sales.orders.create`) and `pending → cancelled` (`POST /orders/:id/cancel`, `sales.orders.cancel`).
 * A `confirmed` order can only be reversed by a sales return (not built in F17-09). The backend
 * re-checks state + permission + location authorization on every call — this only decides which
 * buttons to render. */
export function orderLifecycleActions(status: string): { confirm: boolean; cancel: boolean } {
  const pending = status === 'pending';
  return { confirm: pending, cancel: pending };
}

// --- price approvals ----------------------------------------------------------------------------

export const PRICE_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type PriceApprovalStatus = (typeof PRICE_APPROVAL_STATUSES)[number];

export const PRICE_APPROVAL_STATUS_LABELS: Record<PriceApprovalStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
};

export function priceApprovalStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** `PriceApprovalResponseDto` (order-first exceptional-discount request, ADR-0022). `minPriceAtRequest`
 * is present only for a caller with `pricing.floor.view`; there is never a `cost` field (ADR-0028). */
export interface PriceApproval {
  id: string;
  /** Per-tenant sequential number (e.g. APR-001). */
  approvalNumber: string;
  orderId: string;
  /** The parent order's own number (e.g. ORD-000042) — resolved server-side, never derived from
   * `orderId` on screen. */
  orderNumber: string;
  orderItemId: string;
  /** The parent order's location (Almacén). */
  locationId: string;
  /** Frozen product label of the order line this request is about. */
  productName?: string;
  sku?: string;
  requestedPrice: number;
  maxPriceAtRequest: number;
  minPriceAtRequest?: number;
  discountAmount: number;
  reason: string;
  requestedBy: string;
  /** The requester's display name, resolved server-side — never a raw id on screen. */
  requestedByName: string;
  approvedBy?: string;
  /** The approver/rejecter's display name — present whenever `approvedBy` is. */
  approvedByName?: string;
  status: string;
  requestedAt: string;
  resolvedAt?: string;
}

/** `POST /price-approvals` body — `CreatePriceApprovalDto`. The line already exists on a `pending`
 * order with `isExceptionalDiscount = true`; the server derives every price from that frozen row.
 * `reason` is the only field the client legitimately supplies; `requestedPrice` is an optional
 * cross-check that must equal the frozen line price (`422` on mismatch) — the UI does not send it.
 * `newPrice` is the owner redesign for resubmitting after a rejection: proposes a different price
 * for the line before filing this new request (validated the same way a negotiated price is at
 * checkout). Omit to file against the price already on the line. */
export interface CreatePriceApprovalInput {
  orderItemId: string;
  reason: string;
  requestedPrice?: number;
  newPrice?: number;
}

/** `POST /price-approvals/:id/approve` body — `ResolvePriceApprovalDto`. `price`, when present and
 * different from the line's current price, means the approver is editing it — editing IS approving
 * with that new price (owner redesign), validated and applied atomically with the approval. Omit to
 * approve the price exactly as requested. Never sent to `/reject`. */
export interface ApprovePriceApprovalInput {
  price?: number;
}

// --- sales returns ------------------------------------------------------------------------------

export const RETURN_STATUSES = ['requested', 'inspecting', 'resolved', 'cancelled'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'Solicitada',
  inspecting: 'En inspección',
  resolved: 'Resuelta',
  cancelled: 'Cancelada',
};

export function returnStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'resolved':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'inspecting':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** ADR-0021 dispositions. `restock` re-enters a **sellable** location (stock available again);
 * `quarantine`/`damaged`/`scrap` re-enter a **non-sellable** location (tracked, never counted as
 * available). The backend enforces the sellable/non-sellable pairing. */
export const DISPOSITIONS = ['restock', 'quarantine', 'damaged', 'scrap'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  restock: 'Reingreso a stock (vendible)',
  quarantine: 'Cuarentena',
  damaged: 'Dañado',
  scrap: 'Descarte',
};

/** `ReturnItemResponseDto`. Carries `orderItemId` + `productVariantId` only — no SKU/product name
 * (`GAP-NAME-ENRICHMENT`); the detail page resolves those from the parent order when the caller
 * can read it. `disposition`/`dispositionLocationId`/`inspectedBy`/`inspectedAt`/`notes` appear
 * once the line has been inspected. */
export interface ReturnItem {
  id: string;
  orderItemId: string;
  productVariantId: string;
  /** Frozen SKU / product name of the sold line. */
  sku?: string;
  productName?: string;
  quantityReturned: number;
  disposition?: string;
  dispositionLocationId?: string;
  inspectedBy?: string;
  inspectedAt?: string;
  notes?: string;
}

/** `ReturnResponseDto` — a reversal traced to a **confirmed** order (ADR-0021). `returnNumber` is the
 * per-tenant sequential code (`DEV-001`); `orderNumber` and the user names are resolved server-side. */
export interface Return {
  id: string;
  returnNumber: string;
  orderNumber?: string;
  orderId: string;
  locationId: string;
  status: string;
  requestedBy: string;
  requestedByName?: string;
  receivedBy?: string;
  receivedByName?: string;
  reason: string;
  items: ReturnItem[];
  createdAt: string;
  updatedAt: string;
}

/** `POST /sales-returns` body — `CreateReturnDto` (+ `Idempotency-Key` header). No
 * `tenantId`/`requestedBy`/`status` (all server-derived; a return always starts `requested`). */
export interface CreateReturnInput {
  orderId: string;
  locationId: string;
  reason: string;
  items: { orderItemId: string; quantity: number }[];
}

/** `POST /sales-returns/:id/inspect` body — `InspectReturnDto`. One entry per line being inspected
 * (at least one). */
export interface InspectReturnInput {
  items: {
    returnItemId: string;
    disposition: Disposition;
    dispositionLocationId: string;
    notes?: string;
  }[];
}

/** Which return transitions the backend allows from `status` (`ReturnsService`). `inspect` accepts
 * `requested` or `inspecting`; `resolve` needs `inspecting` + every line inspected (re-checked
 * server-side); `cancel` accepts `requested`/`inspecting`. The backend re-authorizes permission +
 * state + location on every call. */
export function returnActionsForStatus(status: string): { inspect: boolean; resolve: boolean; cancel: boolean } {
  return {
    inspect: status === 'requested' || status === 'inspecting',
    resolve: status === 'inspecting',
    cancel: status === 'requested' || status === 'inspecting',
  };
}

// --- notification (event_outbox) delivery status ----------------------------------------------

export const NOTIFICATION_EVENT_STATUSES = ['pending', 'processing', 'delivered', 'dead_letter'] as const;
export type NotificationEventStatus = (typeof NOTIFICATION_EVENT_STATUSES)[number];

export const NOTIFICATION_OVERALL_STATUSES = ['none', 'pending', 'delivered', 'failed'] as const;
export type NotificationOverallStatus = (typeof NOTIFICATION_OVERALL_STATUSES)[number];

export const NOTIFICATION_OVERALL_LABELS: Record<NotificationOverallStatus, string> = {
  none: 'Sin notificación',
  pending: 'En cola',
  delivered: 'Entregada',
  failed: 'Falló el envío',
};

export function notificationOverallTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'delivered':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

export const NOTIFICATION_EVENT_TYPE_LABELS: Record<string, string> = {
  'sales.order.confirmed': 'Pedido confirmado',
  'sales.order.cancelled': 'Pedido cancelado',
};

/** One `event_outbox` row's delivery metadata — `OrderNotificationEventDto`. Never the payload or
 * the worker error text. */
export interface NotificationEvent {
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  occurredAt: string;
  processedAt?: string;
}

/** `GET /orders/:id/notifications` — `OrderNotificationsResponseDto`. */
export interface OrderNotifications {
  orderId: string;
  overallStatus: string;
  events: NotificationEvent[];
}
