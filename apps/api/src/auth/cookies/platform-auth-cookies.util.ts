import type { FastifyReply } from 'fastify';
import type { AuthConfig } from '../../common/config/auth-config';

/** Mirrors auth-cookies.util.ts's AUTH_COOKIE_PATH, scoped to the platform-admin routes only —
 * narrows the refresh cookie's exposure to exactly the endpoints that need it. */
const PLATFORM_AUTH_COOKIE_PATH = '/api/v1/platform/auth';

export interface PlatformSessionCookies {
  accessToken: string;
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
  csrfToken: string;
}

function baseCookieOptions(authConfig: AuthConfig) {
  return {
    secure: authConfig.cookieSecure,
    sameSite: 'lax' as const,
    ...(authConfig.cookieDomain !== undefined ? { domain: authConfig.cookieDomain } : {}),
  };
}

/**
 * Deliberately distinct cookie names from the tenant session (`platform_*` prefix, never
 * `access_token`/`refresh_token`/`csrf_token`) — multi-tenancy.md#superadmin-vs-tenant's
 * "structurally distinct... not just a flag" applies here too: a browser that happens to hold both
 * a tenant session and a platform-admin session (e.g. an operator testing locally) must never have
 * one silently overwrite or get sent alongside the other.
 */
export function setPlatformSessionCookies(reply: FastifyReply, cookies: PlatformSessionCookies, authConfig: AuthConfig): void {
  const base = baseCookieOptions(authConfig);

  reply.setCookie('platform_access_token', cookies.accessToken, {
    ...base,
    httpOnly: true,
    path: '/',
    maxAge: cookies.accessTokenTtlSeconds,
  });
  reply.setCookie('platform_refresh_token', cookies.refreshToken, {
    ...base,
    httpOnly: true,
    path: PLATFORM_AUTH_COOKIE_PATH,
    maxAge: cookies.refreshTokenTtlSeconds,
  });
  reply.setCookie('platform_csrf_token', cookies.csrfToken, {
    ...base,
    httpOnly: false,
    path: '/',
    maxAge: cookies.refreshTokenTtlSeconds,
  });
}

export function clearPlatformSessionCookies(reply: FastifyReply, authConfig: AuthConfig): void {
  const base = baseCookieOptions(authConfig);
  reply.clearCookie('platform_access_token', { ...base, httpOnly: true, path: '/' });
  reply.clearCookie('platform_refresh_token', { ...base, httpOnly: true, path: PLATFORM_AUTH_COOKIE_PATH });
  reply.clearCookie('platform_csrf_token', { ...base, httpOnly: false, path: '/' });
}
