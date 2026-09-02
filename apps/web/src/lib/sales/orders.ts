import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { DocumentType, Order, OrderStatus } from '../types/sales';

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
  createdFrom?: string;
  createdTo?: string;
}

export async function listOrders(query: ListOrdersQuery = {}): Promise<Paginated<Order>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.customerId) {
    params['customerId'] = query.customerId;
  }
  if (query.documentType) {
    params['documentType'] = query.documentType;
  }
  if (query.createdFrom) {
    params['createdFrom'] = query.createdFrom;
  }
  if (query.createdTo) {
    params['createdTo'] = query.createdTo;
  }
  return serverApiFetch<Paginated<Order>>('/api/v1/orders', { query: params });
}

export async function getOrder(id: string): Promise<Order> {
  return serverApiFetch<Order>(`/api/v1/orders/${id}`);
}
