import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { Return, ReturnStatus } from '../types/sales';

/**
 * Server-side reads for sales returns (`GET /api/v1/sales-returns*`, permission `sales.returns.view`).
 * Every mutation (`POST /sales-returns`, `/:id/inspect`, `/:id/resolve`, `/:id/cancel`) goes through
 * `apiFetch` in the relevant client component — `create` and `resolve` additionally require an
 * `Idempotency-Key` header.
 *
 * `ListReturnsQueryDto` accepts only `status` and `orderId` (offset pagination) — no text search,
 * no sort, no date filter.
 */
export interface ListReturnsQuery {
  page?: number;
  pageSize?: number;
  status?: ReturnStatus;
  orderId?: string;
  /** `sales_returns.location_id` (Recibido en). */
  locationId?: string;
  /** Business-day filter (`YYYY-MM-DD`, tenant timezone, whole final day inclusive). */
  dateFrom?: string;
  dateTo?: string;
}

export async function listReturns(query: ListReturnsQuery = {}): Promise<Paginated<Return>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.orderId) {
    params['orderId'] = query.orderId;
  }
  if (query.locationId) {
    params['locationId'] = query.locationId;
  }
  if (query.dateFrom) {
    params['dateFrom'] = query.dateFrom;
  }
  if (query.dateTo) {
    params['dateTo'] = query.dateTo;
  }
  return serverApiFetch<Paginated<Return>>('/api/v1/sales-returns', { query: params });
}

export async function getReturn(id: string): Promise<Return> {
  return serverApiFetch<Return>(`/api/v1/sales-returns/${id}`);
}
