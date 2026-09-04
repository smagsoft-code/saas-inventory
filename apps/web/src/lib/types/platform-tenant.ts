/**
 * Mirrors `apps/api/src/administration/dto/platform-tenant-response.dto.ts` — the SuperAdmin view
 * of a company (`PlatformTenantResponseDto`). Kept local to the frontend, the same convention as
 * `lib/types/platform-session.ts`; no field is added that the endpoint does not send.
 *
 * Endpoints (all `@PlatformOnly()` — no tenant RBAC, no permission code; the platform principal is
 * the whole authorization. `:tenantId` **is** a legitimate path param here — the one place in the
 * API where that is correct, because the caller has no tenant of its own):
 *  - `GET  /api/v1/platform/tenants`                     → PlatformTenant[]  (WHOLE array, NOT paginated)
 *  - `GET  /api/v1/platform/tenants/:tenantId`           → PlatformTenant     (404 if missing)
 *  - `POST /api/v1/platform/tenants/:tenantId/suspend`   → PlatformTenant     (audited, CSRF)
 *  - `POST /api/v1/platform/tenants/:tenantId/activate`  → PlatformTenant     (audited, CSRF)
 *
 * There is **no** create / edit / delete endpoint (`GAP-SA-CREATE-TENANT` + no platform PATCH/DELETE),
 * **no** per-tenant user/admin read (`GAP-SA-TENANT-ADMINS`), **no** impersonation
 * (`GAP-SA-IMPERSONATION`), **no** metrics (`GAP-PLATFORM-AGGREGATE`). The list carries no server
 * filter / sort / search / pagination params — those are done client-side over the array.
 */

/** `tenants.status` — the DB CHECK allows these three. `archived` exists but **no endpoint sets
 * it** (`PlatformTenantsService.setStatus` only takes `active`/`suspended`), so the UI shows it as
 * a badge but never offers it as an action. */
export const TENANT_LIFECYCLE_STATUSES = ['active', 'suspended', 'archived'] as const;
export type TenantLifecycleStatus = (typeof TENANT_LIFECYCLE_STATUSES)[number];

export const TENANT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  archived: 'Archived',
};

export function tenantStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'active':
      return 'success';
    case 'suspended':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `GET /platform/tenants` list item / `GET /platform/tenants/:id` — `PlatformTenantResponseDto`. */
export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  isDemo: boolean;
  createdAt: string;
}

/** Which lifecycle action the SuperAdmin can take from a given status — mirrors
 * `PlatformTenantsService.setStatus` (`active` ↔ `suspended` only). A backend re-check is the
 * authority; this only decides which button to render. */
export function tenantLifecycleAction(status: string): 'suspend' | 'activate' | null {
  if (status === 'active') return 'suspend';
  if (status === 'suspended') return 'activate';
  return null;
}
