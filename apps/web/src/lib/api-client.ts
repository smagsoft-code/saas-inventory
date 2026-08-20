/**
 * The single, thin API client (frontend.md#api-client) — every call to the backend goes through
 * this file, whether from a Server Component (with a forwarded Cookie header) or a Client
 * Component (browser cookies attached automatically via `credentials: 'include'`).
 *
 * `process.env.NEXT_PUBLIC_API_URL` is referenced directly (not through a wrapped helper) because
 * Next.js's compiler only inlines `NEXT_PUBLIC_*` variables into the client bundle when it can see
 * the literal `process.env.NEXT_PUBLIC_X` expression statically in the source file — routing it
 * through an imported function call would silently break that for client components.
 */

export interface ApiErrorShape {
  statusCode: number;
  code: string;
  message: string;
  correlationId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly correlationId: string | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getApiBaseUrl(): string {
  // Server Components resolve API_URL (frontend.md#api-client: "server-side, never a secret");
  // `process.env.API_URL` is simply undefined in the browser bundle (only NEXT_PUBLIC_* vars are
  // inlined there), so this falls through to NEXT_PUBLIC_API_URL for Client Components.
  const url = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error('Missing API_URL/NEXT_PUBLIC_API_URL environment variable.');
  }
  return url;
}

/** Reads the (deliberately non-httpOnly) csrf_token cookie for the double-submit header —
 * common/guards/csrf.guard.ts on the API side. Browser-only; a server-side caller passes its own
 * forwarded cookies via `cookieHeader` and never needs to send this header itself (Server
 * Components never issue the state-changing calls that need it). */
function readCsrfTokenCookie(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const match = /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Server-side only: the caller's own request cookies, forwarded so the API sees the session
   * (lib/current-user.ts). Never used client-side — the browser attaches its cookies itself. */
  cookieHeader?: string;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.cookieHeader) {
    headers['Cookie'] = options.cookieHeader;
  }
  if (method !== 'GET') {
    const csrfToken = readCsrfTokenCookie();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const raw = await response.text();
  const data: unknown = raw ? JSON.parse(raw) : undefined;

  if (!response.ok) {
    const shape = data as Partial<ApiErrorShape> | undefined;
    throw new ApiError(
      response.status,
      shape?.code ?? 'UNKNOWN_ERROR',
      shape?.message ?? 'Something went wrong. Please try again.',
      shape?.correlationId,
    );
  }

  return data as T;
}
