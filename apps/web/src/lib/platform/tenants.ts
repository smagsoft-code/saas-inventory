import { serverApiFetch } from '../api/server';
import type { PlatformTenant } from '../types/platform-tenant';

/**
 * Server-side reads for the SuperAdmin company views (`GET /api/v1/platform/tenants*`,
 * `@PlatformOnly()`). Uses the shared `serverApiFetch` — it forwards **all** request cookies, so
 * the `platform_*` session cookies reach the backend with no separate client (Prompt F17-13 §15:
 * a distinct client is only built if the contract forces it — it does not).
 *
 * The list endpoint returns the **whole array, unpaginated**, with no server filter/sort/search
 * params (`f17-super-admin.md` §2) — the list screen filters/sorts client-side. The two lifecycle
 * mutations (`/suspend`, `/activate`) go through `apiFetch` in the detail page's client component,
 * which also attaches the `platform_csrf_token` double-submit header.
 *
 * These calls never send a `tenantId` in a header/body/query — `:tenantId` is a path segment on
 * the detail/mutation routes only, and only ever the id of a row the SuperAdmin explicitly opened.
 */
export async function listPlatformTenants(): Promise<PlatformTenant[]> {
  return serverApiFetch<PlatformTenant[]>('/api/v1/platform/tenants');
}

export async function getPlatformTenant(tenantId: string): Promise<PlatformTenant> {
  return serverApiFetch<PlatformTenant>(`/api/v1/platform/tenants/${tenantId}`);
}
