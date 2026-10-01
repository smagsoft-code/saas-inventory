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
 *  - `POST /api/v1/platform/tenants`                     → onboarding result (ADR-0036, closes GAP-SA-CREATE-TENANT)
 *  - `POST /api/v1/platform/tenants/:tenantId/suspend`   → PlatformTenant     (audited, CSRF)
 *  - `POST /api/v1/platform/tenants/:tenantId/activate`  → PlatformTenant     (audited, CSRF)
 *  - `GET/POST /api/v1/platform/tenants/:tenantId/admin-invitation[/resend|/revoke]` (ADR-0036)
 *  - `POST /api/v1/platform/tenants/:tenantId/support-sessions`, `GET/POST /api/v1/platform/support-sessions/current[/end]` (ADR-0036, Tenant Support)
 *
 * There is still **no** edit/delete endpoint, **no** per-tenant user/admin *browsing* outside a
 * live support session (`GAP-SA-TENANT-ADMINS` — the curated support read surface is narrower and
 * requires an active, audited session), **no** metrics beyond counts (`GAP-PLATFORM-AGGREGATE`).
 * The list carries no server filter / sort / search / pagination params — those are done
 * client-side over the array.
 */

/** `tenants.status` — the DB CHECK allows these three. `archived` exists but **no endpoint sets
 * it** (`PlatformTenantsService.setStatus` only takes `active`/`suspended`), so the UI shows it as
 * a badge but never offers it as an action. */
export const TENANT_LIFECYCLE_STATUSES = ['active', 'suspended', 'archived'] as const;
export type TenantLifecycleStatus = (typeof TENANT_LIFECYCLE_STATUSES)[number];

export const TENANT_STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  suspended: 'Suspendida',
  archived: 'Archivada',
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

/** `POST /platform/tenants` response — ADR-0036. `invitationUrl` is shown exactly once, at
 * creation/resend time — never persisted client-side beyond the current page render. */
export interface PlatformTenantOnboardingResult {
  tenant: PlatformTenant;
  admin: { id: string; email: string; fullName: string };
  identityReused: boolean;
  invitationUrl?: string;
  invitationExpiresAt?: string;
}

export const INVITATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  sent: 'Pendiente',
  accepted: 'Aceptada',
  expired: 'Expirada',
  revoked: 'Revocada',
};

export function invitationStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'accepted':
      return 'success';
    case 'sent':
    case 'pending':
      return 'warning';
    case 'expired':
    case 'revoked':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `GET /platform/tenants/:tenantId/admin-invitation` — never the token, never a password. */
export interface AdminInvitationStatus {
  id: string;
  status: string;
  sentAt?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export type SupportSessionMode = 'read' | 'write';

/** `platform_support_sessions` (ADR-0036, Tenant Support) — `GET/POST /platform/support-sessions/current[/end]`,
 * `POST /platform/tenants/:tenantId/support-sessions`. */
export interface SupportSession {
  id: string;
  tenantId: string;
  mode: SupportSessionMode;
  reason: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
}
