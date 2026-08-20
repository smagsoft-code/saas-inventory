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
  refreshTokenTtlSeconds: number;
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
    refreshTokenTtlSeconds: Number(getOptionalEnvVar('REFRESH_TOKEN_TTL_SECONDS', '2592000')),
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
