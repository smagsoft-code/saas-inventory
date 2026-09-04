/**
 * The authenticated user as returned by `GET /api/v1/auth/me`
 * (`apps/api/src/auth/dto/auth-session-response.dto.ts` — `CurrentUserResponseDto`). Mirrored
 * locally, the same convention as `lib/types/core.ts`; no field is added that the endpoint does
 * not send.
 */
export interface Session {
  /** The tenant-scoped `users.id`. */
  id: string;
  /** The global `identities.id` this user belongs to (016-C / ADR-0033). */
  identityId: string;
  tenantId: string;
  /** The active tenant slug — display only. Login no longer takes it (016-C); which company is
   * chosen after credentials are verified, via `POST /auth/select-tenant`. */
  tenantSlug: string;
  email: string;
  fullName: string;
  status: string;
  /** Effective permission codes for this user in this tenant. The frontend uses these to hide
   * controls the request would be refused anyway — the API stays the authority (CLAUDE.md §7.6). */
  permissions: string[];
  /** The active tenant's IANA timezone (`'UTC'` default) — F18-01. Unlike
   * `GET /administration/tenant-settings`, always present regardless of the caller's permissions;
   * closes `GAP-TZ-VISIBILITY` for any screen that needs to resolve "today"/"this month" in the
   * tenant's own timezone. */
  timezone: string;
}

/**
 * `POST /api/v1/auth/login` response (016-C — `LoginResponseDto`). Two shapes discriminated by
 * `status`:
 *  - `authenticated` — the identity has exactly one active membership; session cookies are set and
 *    `user` is present. Login is complete.
 *  - `tenant_selection_required` — the identity has several active memberships; NO session yet.
 *    `availableTenants` is the authoritative picker list and the httpOnly `tenant_selection`
 *    cookie has been set. The caller finishes with `POST /auth/select-tenant`.
 *
 * `selectionToken` is echoed only for non-browser callers; the web app never reads or stores it —
 * the browser carries the httpOnly cookie automatically.
 */
export interface AvailableTenant {
  tenantId: string;
  name: string;
}

export type LoginResponse =
  | { status: 'authenticated'; user: Session; accessTokenExpiresAt: string }
  | {
      status: 'tenant_selection_required';
      availableTenants: AvailableTenant[];
      selectionTokenExpiresAt: string;
    };

/** `POST /api/v1/auth/select-tenant` response (`AuthSessionResponseDto`). */
export interface AuthSessionResponse {
  user: Session;
  accessTokenExpiresAt: string;
}
