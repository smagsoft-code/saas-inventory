import { getOptionalEnvVar, getRequiredEnvVar } from '@saas-inventory/config';

/**
 * Centralized, environment-driven auth configuration (CLAUDE.md §7.4/§20 — no magic values
 * scattered across files). Read once via getAuthConfig() and injected under the AUTH_CONFIG DI
 * token everywhere it's needed (common guards, auth services) — see auth.module.ts / common
 * guard providers.
 */
export interface AuthConfig {
  jwtSecret: string;
  /** Used as an HMAC pepper when hashing opaque refresh tokens for storage (refresh-token.service.ts)
   * — not used to sign a JWT (refresh tokens are opaque, not JWTs), but keeps the pre-provisioned
   * JWT_REFRESH_SECRET env var meaningful rather than unused. */
  refreshTokenPepper: string;
  accessTokenTtlSeconds: number;
  /** OUI-003 — a *sliding* inactivity window, not an absolute session lifetime: every successful
   * `POST /auth/refresh` rotates the token and reissues it with `now + refreshTokenTtlSeconds`
   * (`AuthService.refresh` -> `RefreshTokenService.generate`), so a user active at least once per
   * this many seconds is refreshed silently forever; one idle longer than this has their next
   * request rejected and is sent back to `/login`. */
  refreshTokenTtlSeconds: number;
  /** TTL of the interim tenant-selection token issued by `POST /auth/login` when an identity has
   * more than one active membership (016-C). Deliberately short — it only needs to survive a user
   * picking a company. */
  selectionTokenTtlSeconds: number;
  /** ADR-0036 (Tenant Onboarding + Tenant Support). How long a SuperAdmin-issued
   * `tenant_admin_invitations` link stays acceptable — default 7 days, long enough for a real
   * person to receive and act on a manually-distributed link (no email delivery exists yet). */
  invitationTokenTtlSeconds: number;
  /** ADR-0036. How long a `platform_support_sessions` window stays usable before it must be
   * restarted — default 30 minutes, short enough that a forgotten "salir del modo soporte" cannot
   * leave a tenant exposed indefinitely. */
  supportSessionTtlSeconds: number;
  argon2: {
    memoryCostKib: number;
    timeCost: number;
    parallelism: number;
  };
  cookieDomain: string | undefined;
  /** `Secure` cookie flag — true outside local development, per security.md's cookie rules. */
  cookieSecure: boolean;
  rateLimit: {
    ttlSeconds: number;
    max: number;
  };
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

let cached: AuthConfig | undefined;

export function getAuthConfig(): AuthConfig {
  cached ??= {
    jwtSecret: getRequiredEnvVar('JWT_SECRET'),
    refreshTokenPepper: getRequiredEnvVar('JWT_REFRESH_SECRET'),
    accessTokenTtlSeconds: Number(getOptionalEnvVar('ACCESS_TOKEN_TTL_SECONDS', '900')),
    // OUI-003: a sliding inactivity window, not an absolute session cap — every successful refresh
    // rotates the token and resets this clock (AuthService.refresh -> RefreshTokenService.generate).
    // Default 1 hour (owner decision) so the fallback stays safe even with no .env override.
    refreshTokenTtlSeconds: Number(getOptionalEnvVar('REFRESH_TOKEN_TTL_SECONDS', '3600')),
    selectionTokenTtlSeconds: Number(getOptionalEnvVar('SELECTION_TOKEN_TTL_SECONDS', '300')),
    invitationTokenTtlSeconds: Number(getOptionalEnvVar('INVITATION_TOKEN_TTL_SECONDS', String(7 * 24 * 3600))),
    supportSessionTtlSeconds: Number(getOptionalEnvVar('SUPPORT_SESSION_TTL_SECONDS', '1800')),
    argon2: {
      memoryCostKib: Number(getOptionalEnvVar('ARGON2_MEMORY_COST_KIB', '19456')),
      timeCost: Number(getOptionalEnvVar('ARGON2_TIME_COST', '2')),
      parallelism: Number(getOptionalEnvVar('ARGON2_PARALLELISM', '1')),
    },
    cookieDomain: getOptionalEnvVar('COOKIE_DOMAIN', '') || undefined,
    cookieSecure: getOptionalEnvVar('NODE_ENV', 'development') === 'production',
    rateLimit: {
      ttlSeconds: Number(getOptionalEnvVar('AUTH_RATE_LIMIT_TTL_SECONDS', '60')),
      max: Number(getOptionalEnvVar('AUTH_RATE_LIMIT_MAX', '5')),
    },
  };
  return cached;
}

/** Test-only: clears the memoized config so a test can change env vars and re-read them. */
export function resetAuthConfigCache(): void {
  cached = undefined;
}
