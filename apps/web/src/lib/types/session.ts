/**
 * The authenticated user as returned by `GET /api/v1/auth/me`
 * (`apps/api/src/auth/dto/auth-session-response.dto.ts` — `CurrentUserResponseDto`). Mirrored
 * locally, the same convention as `lib/types/core.ts`; no field is added that the endpoint does
 * not send.
 */
export interface Session {
  id: string;
  tenantId: string;
  /** The workspace slug — also what the user types to log back in (`LoginDto.tenantSlug`). */
  tenantSlug: string;
  email: string;
  fullName: string;
  status: string;
  /** Effective permission codes for this user in this tenant. The frontend uses these to hide
   * controls the request would be refused anyway — the API stays the authority (CLAUDE.md §7.6). */
  permissions: string[];
}
