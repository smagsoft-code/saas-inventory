import { serverApiFetch } from '../api/server';
import type { AdminInvitationStatus, PlatformTenant, SupportSession } from '../types/platform-tenant';

/**
 * Server-side reads for the SuperAdmin company views (`GET /api/v1/platform/tenants*`,
 * `@PlatformOnly()`). Uses the shared `serverApiFetch` — it forwards **all** request cookies, so
 * the `platform_*` session cookies reach the backend with no separate client (Prompt F17-13 §15:
 * a distinct client is only built if the contract forces it — it does not).
 *
 * The list endpoint returns the **whole array, unpaginated**, with no server filter/sort/search
 * params (`f17-super-admin.md` §2) — the list screen filters/sorts client-side. Mutations
 * (`/suspend`, `/activate`, create-tenant, resend/revoke invitation, start/end support session) go
 * through `apiFetch` in client components, which also attaches the `platform_csrf_token`
 * double-submit header.
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

/** ADR-0036 — `null` when the tenant's founding admin never needed an invitation (their email
 * already resolved to an active global identity at creation time). */
export async function getAdminInvitationStatus(tenantId: string): Promise<AdminInvitationStatus | null> {
  return serverApiFetch<AdminInvitationStatus | null>(`/api/v1/platform/tenants/${tenantId}/admin-invitation`);
}

/** ADR-0036 (Tenant Support) — the caller's own current support session, or `null`. Read
 * server-side so the shell/banner can render it on first paint without a client round trip. */
export async function getCurrentSupportSession(): Promise<SupportSession | null> {
  return serverApiFetch<SupportSession | null>('/api/v1/platform/support-sessions/current');
}
