/**
 * The single, thin API client (frontend.md#api-client). Every backend call — from a Server
 * Component (forwarding the request's `Cookie` header) or a Client Component (browser cookies
 * attached automatically by `credentials: 'include'`) — goes through `apiFetch`.
 *
 * Base URL (frontend.md#api-client — "server-side, never a secret"; Prompt 016 §23):
 *   - Server: `API_URL` (the API is reached directly, container-to-container in prod).
 *   - Browser: same-origin by default (empty base) — `next.config.ts` rewrites `/api/*` to the
 *     API, which is exactly how the Caddy reverse proxy serves prod (docs/deployment/docker.md).
 *     `NEXT_PUBLIC_API_URL` still overrides it for a genuinely cross-origin deployment whose CORS
 *     + cookie flags are set up for that.
 * `process.env.NEXT_PUBLIC_*` is referenced as a literal member expression (not via a helper) so
 * Next.js's compiler inlines it into the client bundle.
 *
 * 401 handling (Prompt 016 §8): on the browser, a 401 triggers **one** `POST /auth/refresh`
 * (deduplicated across concurrent calls) and **one** retry of the original request. A failed
 * refresh clears no server state we own here — it emits `session-expired` and rethrows. Never
 * refreshes on 403/400/404/409/422/429/5xx, never refreshes the refresh call itself, never more
 * than once per request.
 */

import { ApiError, type ApiErrorShape } from './errors';
import { emitSessionExpired } from '../auth/session-events';

const AUTH_REFRESH_PATH = '/api/v1/auth/refresh';

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Server-side only: the caller's forwarded request cookies (see `lib/api/server.ts`). Its
   * presence is also how the client knows it is running server-side and must not try to refresh —
   * a Server Component render cannot write cookies back to the browser. */
  cookieHeader?: string;
  /** Extra query params, appended if the path does not already carry a query string. */
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Internal: set once a 401 retry has already happened for this logical request. */
  _retried?: boolean;
}

function browserApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? '';
}

function serverApiBaseUrl(): string {
  const url = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error('Missing API_URL environment variable (see .env.example).');
  }
  return url;
}

function resolveUrl(path: string, query: ApiFetchOptions['query']): string {
  const base = typeof window === 'undefined' ? serverApiBaseUrl() : browserApiBaseUrl();
  let url = `${base}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) {
      url += (path.includes('?') ? '&' : '?') + qs;
    }
  }
  return url;
}

/** Reads the (deliberately non-httpOnly) CSRF cookie for the double-submit header that
 * `apps/api/src/common/guards/csrf.guard.ts` requires on every state-changing request. Browser
 * only — a Server Component never issues the mutations that need it.
 *
 * Falls back to `platform_csrf_token` for the platform-admin context: that guard accepts either
 * cookie (`csrf_token ?? platform_csrf_token`), and a pure platform admin holds only the latter. */
function readCsrfTokenCookie(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const match =
    /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie) ??
    /(?:^|;\s*)platform_csrf_token=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function randomCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // A non-JSON body (e.g. a proxy's HTML error page) — surfaced as an opaque error below.
    return undefined;
  }
}

function toApiError(status: number, data: unknown): ApiError {
  const shape = (data ?? {}) as Partial<ApiErrorShape>;
  return new ApiError(
    status,
    shape.code ?? 'UNKNOWN_ERROR',
    shape.message ?? 'Something went wrong. Please try again.',
    shape.correlationId,
    shape.details,
  );
}

// --- single-flight refresh ------------------------------------------------------------------

let inFlightRefresh: Promise<boolean> | null = null;

/** POST /auth/refresh at most once even if several requests 401 at the same time. Resolves to
 * whether a new session was issued. Never throws. */
async function refreshSession(): Promise<boolean> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }
  inFlightRefresh = (async () => {
    try {
      const csrfToken = readCsrfTokenCookie();
      const response = await fetch(resolveUrl(AUTH_REFRESH_PATH, undefined), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        credentials: 'include',
        cache: 'no-store',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

// --- main entry point ----------------------------------------------------------------------

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const isServer = typeof window === 'undefined' || options.cookieHeader !== undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Correlation-Id': randomCorrelationId(),
  };
  if (options.cookieHeader) {
    headers['Cookie'] = options.cookieHeader;
  }
  if (method !== 'GET' && !isServer) {
    const csrfToken = readCsrfTokenCookie();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  let response: Response;
  try {
    response = await fetch(resolveUrl(path, options.query), {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.', undefined);
  }

  const data = await parseBody(response);

  if (response.ok) {
    return data as T;
  }

  // 401: try exactly one refresh + retry, browser only, and never for the refresh endpoint.
  if (response.status === 401 && !isServer && !options._retried && path !== AUTH_REFRESH_PATH) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
    emitSessionExpired();
  }

  throw toApiError(response.status, data);
}
