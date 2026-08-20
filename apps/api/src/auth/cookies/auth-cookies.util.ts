import type { FastifyReply } from 'fastify';
import type { AuthConfig } from '../../common/config/auth-config';

/** The only path refresh_token is ever sent to — narrows its exposure to exactly the two
 * endpoints that need it (security.md#authentication's cookie flags: "path/domain restricted
 * where corresponds"). Matches main.ts's global prefix + URI versioning (`/api/v1/auth/...`). */
const AUTH_COOKIE_PATH = '/api/v1/auth';

export interface SessionCookies {
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
    // Only present the `domain` key at all when configured — exactOptionalPropertyTypes rejects
    // an explicit `domain: undefined` against @fastify/cookie's `domain?: string`.
    ...(authConfig.cookieDomain !== undefined ? { domain: authConfig.cookieDomain } : {}),
  };
}

export function setSessionCookies(reply: FastifyReply, cookies: SessionCookies, authConfig: AuthConfig): void {
  const base = baseCookieOptions(authConfig);

  reply.setCookie('access_token', cookies.accessToken, {
    ...base,
    httpOnly: true,
    path: '/',
    maxAge: cookies.accessTokenTtlSeconds,
  });
  reply.setCookie('refresh_token', cookies.refreshToken, {
    ...base,
    httpOnly: true,
    path: AUTH_COOKIE_PATH,
    maxAge: cookies.refreshTokenTtlSeconds,
  });
  // Not httpOnly — the frontend must be able to read it to echo it back in the X-CSRF-Token
  // header (double-submit pattern, common/guards/csrf.guard.ts). It is not a bearer credential by
  // itself: knowing it proves nothing without also holding the (httpOnly) session cookies.
  reply.setCookie('csrf_token', cookies.csrfToken, {
    ...base,
    httpOnly: false,
    path: '/',
    maxAge: cookies.refreshTokenTtlSeconds,
  });
}

export function clearSessionCookies(reply: FastifyReply, authConfig: AuthConfig): void {
  const base = baseCookieOptions(authConfig);
  reply.clearCookie('access_token', { ...base, httpOnly: true, path: '/' });
  reply.clearCookie('refresh_token', { ...base, httpOnly: true, path: AUTH_COOKIE_PATH });
  reply.clearCookie('csrf_token', { ...base, httpOnly: false, path: '/' });
}
