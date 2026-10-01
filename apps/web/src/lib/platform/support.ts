import { serverApiFetch } from '../api/server';

/** ADR-0036 (Tenant Support) — the curated SUPPORT_READ surface (users + warehouses only, see
 * `GAP-SUPPORT-READ-SCOPE`). Requires a live support session for the requested `tenantId`
 * (`SupportSessionGuard`); a call with none is 403, surfaced by the page's own error handling. */
export interface SupportUser {
  id: string;
  email: string;
  fullName: string;
  status: string;
  roleNames: string[];
  createdAt: string;
}

export interface SupportWarehouse {
  id: string;
  name: string;
  code: string;
  status: string;
}

export async function listSupportUsers(tenantId: string): Promise<SupportUser[]> {
  return serverApiFetch<SupportUser[]>(`/api/v1/platform/tenants/${tenantId}/support/users`);
}

export async function listSupportWarehouses(tenantId: string): Promise<SupportWarehouse[]> {
  return serverApiFetch<SupportWarehouse[]>(`/api/v1/platform/tenants/${tenantId}/support/warehouses`);
}
