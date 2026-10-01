import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { Customer, CustomerStatus, CustomerType } from '../types/sales';

/**
 * Server-side reads for customers (`GET /api/v1/customers*`, permission `sales.customers.view`).
 * Client-side mutations (`POST`/`PATCH`) go through `apiFetch` directly in the form component —
 * the same split F17-04/F17-05 use.
 *
 * `ListCustomersQueryDto` accepts `q` (real free-text search over firstName/lastName/taxId/email/
 * phone — the one endpoint that has it, `GAP-SEARCH`), `status`, `type`. No `sort`. Owner redesign:
 * `/customers` only ever sends `q` now (Tipo/Estado filters were removed from the list UI) — `status`/
 * `type` stay here for API completeness, same as every other kept-but-unused backend capability in
 * this codebase.
 */
export interface ListCustomersQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: CustomerStatus;
  type?: CustomerType;
}

export async function listCustomers(query: ListCustomersQuery = {}): Promise<Paginated<Customer>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.q) {
    params['q'] = query.q;
  }
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.type) {
    params['type'] = query.type;
  }
  return serverApiFetch<Paginated<Customer>>('/api/v1/customers', { query: params });
}

export async function getCustomer(id: string): Promise<Customer> {
  return serverApiFetch<Customer>(`/api/v1/customers/${id}`);
}
