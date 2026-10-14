import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { PriceApproval, PriceApprovalStatus } from '../types/sales';

/**
 * Server-side reads for the exceptional-discount approval queue
 * (`GET /api/v1/price-approvals*`). The two GET routes require **either**
 * `pricing.discount.request` **or** `pricing.discount.approve` (`@RequireAnyPermission`, F17-09 —
 * `GAP-APPROVALS-PERMISSION` closed). Resolving a request (`/approve`, `/reject`) needs
 * `pricing.discount.approve`; filing one (`POST /price-approvals`) needs `pricing.discount.request`
 * — both go through `apiFetch` in the relevant client component.
 *
 * `ListPriceApprovalsQueryDto` accepts only `status` and `orderId` (offset pagination) — no text
 * search, no sort, no date filter.
 */
export interface ListPriceApprovalsQuery {
  page?: number;
  pageSize?: number;
  status?: PriceApprovalStatus;
  orderId?: string;
  /** The parent order's location (Almacén). */
  locationId?: string;
  /** Business-day filter on `requested_at` (`YYYY-MM-DD`, tenant timezone, whole final day inclusive). */
  dateFrom?: string;
  dateTo?: string;
}

export async function listPriceApprovals(query: ListPriceApprovalsQuery = {}): Promise<Paginated<PriceApproval>> {
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
  return serverApiFetch<Paginated<PriceApproval>>('/api/v1/price-approvals', { query: params });
}

export async function getPriceApproval(id: string): Promise<PriceApproval> {
  return serverApiFetch<PriceApproval>(`/api/v1/price-approvals/${id}`);
}
