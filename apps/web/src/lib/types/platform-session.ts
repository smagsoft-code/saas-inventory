/**
 * The authenticated platform administrator as returned by `GET /api/v1/platform/auth/me`
 * (`apps/api/src/auth/dto/platform-auth-session-response.dto.ts` — `CurrentPlatformAdminResponseDto`).
 * Mirrored locally, the same convention as `lib/types/session.ts`; no field is added that the
 * endpoint does not send.
 *
 * A platform admin is **structurally separate** from a tenant user (multi-tenancy.md#superadmin-vs-tenant):
 * distinct table (`platform_admins`), distinct session cookies (`platform_*`), a token with
 * `context: 'global'` and **no `tenantId`**. There is no tenant, no permission list, no location
 * scope here.
 */
export interface PlatformSession {
  id: string;
  email: string;
  fullName: string;
  status: string;
}

/** `POST /api/v1/platform/auth/login` response (`PlatformAuthSessionResponseDto`). */
export interface PlatformAuthResponse {
  admin: PlatformSession;
  accessTokenExpiresAt: string;
}
