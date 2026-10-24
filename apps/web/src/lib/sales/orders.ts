import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { DocumentType, Order, OrderNotifications, OrderStatus } from '../types/sales';

/**
 * Server-side reads for sales orders (`GET /api/v1/orders*`, permission `sales.orders.view`).
 * Checkout (`POST /orders`) goes through `apiFetch` in the New Sale client component.
 *
 * `ListOrdersQueryDto` accepts `status`, `customerId`, `documentType`, `createdFrom`/`createdTo`.
 * F17-08 only uses `customerId` (the customer-detail order list). Order visibility is **tenant-wide**
 * for a `sales.orders.view` holder — the endpoint does not location-scope it (`GAP-ORDERS-LOCATION`).
 */
export interface ListOrdersQuery {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  customerId?: string;
  documentType?: DocumentType;
  /** `orders.location_id` equality (Almacén). */
  locationId?: string;
  /** Orders placed at any Almacén of this Sucursal (warehouse). */
  warehouseId?: string;
  /** Only this seller's orders — honoured by the backend only for `sales.orders.view_all` holders. */
  placedByUserId?: string;
  /** History-table column filters (substring search / roll-up status). */
  /** One search box: order number, customer or seller. */
  q?: string;
  orderNumber?: string;
  customerName?: string;
  sellerName?: string;
  total?: string;
  notificationStatus?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  createdFrom?: string;
  createdTo?: string;
  /** Business-day filter (`YYYY-MM-DD`, tenant timezone, whole final day inclusive). Takes
   * precedence over `createdFrom`/`createdTo` in the backend. `dateTo` defaults to `dateFrom`. */
  dateFrom?: string;
  dateTo?: string;
}

/** Same-origin download link for the Excel/PDF of the history — carries exactly the filters (and
 * sort) of `query`, never a page: the export is always the whole filtered set. */
export function buildOrdersExportHref(query: ListOrdersQuery, format: 'xlsx' | 'pdf'): string {
  const params = ordersFilterParams(query);
  return `/api/v1/orders/export?${new URLSearchParams({ ...params, format })}`;
}

export async function listOrders(query: ListOrdersQuery = {}): Promise<Paginated<Order>> {
  const params: Record<string, string | number> = {
    ...ordersFilterParams(query),
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  return serverApiFetch<Paginated<Order>>('/api/v1/orders', { query: params });
}

function ordersFilterParams(query: ListOrdersQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.customerId) {
    params['customerId'] = query.customerId;
  }
  if (query.documentType) {
    params['documentType'] = query.documentType;
  }
  if (query.locationId) {
    params['locationId'] = query.locationId;
  }
  if (query.warehouseId) {
    params['warehouseId'] = query.warehouseId;
  }
  if (query.placedByUserId) {
    params['placedByUserId'] = query.placedByUserId;
  }
  for (const key of ['q', 'orderNumber', 'customerName', 'sellerName', 'total', 'notificationStatus'] as const) {
    const value = query[key];
    if (value) params[key] = value;
  }
  if (query.sort) {
    params['sort'] = query.sort;
  }
  if (query.dir) {
    params['dir'] = query.dir;
  }
  if (query.createdFrom) {
    params['createdFrom'] = query.createdFrom;
  }
  if (query.createdTo) {
    params['createdTo'] = query.createdTo;
  }
  if (query.dateFrom) {
    params['dateFrom'] = query.dateFrom;
  }
  if (query.dateTo) {
    params['dateTo'] = query.dateTo;
  }
  return params;
}

export async function getOrder(id: string): Promise<Order> {
  return serverApiFetch<Order>(`/api/v1/orders/${id}`);
}

/**
 * Delivery status of the order's domain-event notifications (`GET /api/v1/orders/:id/notifications`,
 * permission `sales.orders.view`) — F17-10, closing `GAP-NOTIF-STATUS`. Read-only metadata; there
 * is no retry endpoint (`GAP-NOTIF-RETRY-BACKEND`). A deployment with outbound notifications
 * disabled legitimately reports every event `pending`.
 */
export async function getOrderNotifications(id: string): Promise<OrderNotifications> {
  return serverApiFetch<OrderNotifications>(`/api/v1/orders/${id}/notifications`);
}
