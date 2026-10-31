import { randomUUID } from 'node:crypto';
import type { ApiFn } from './qa-seed';
import { SeedGuardError } from './qa-seed-guards';

/**
 * The HTTP client of the QA seed CLI (D-8E.26-B4.3, M1), extracted from `seed-qa-data.ts` so its behaviour can be tested.
 *
 * Why this exists as its own module: the seed validates that the API URL is loopback BEFORE the first request, but `fetch` follows
 * redirects by default. A local service answering 307/308 could therefore forward the login POST — with the QA credentials in its body —
 * to a remote host, and the loopback check would never see it. Every network call of the CLI goes through `send` below, which forces
 * `redirect: 'error'` AFTER spreading the caller's options, so no caller can turn following back on. A 3xx that still reaches the code
 * (a `manual`-style response from an unusual fetch) is refused as well.
 *
 * Nothing in an error message here contains a request body, a header, a cookie or a token.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class RedirectRefusedError extends Error {
  constructor(method: string, urlPath: string) {
    super(`The API answered ${method} ${urlPath} with a redirect; the seed never follows redirects. Nothing was sent anywhere else.`);
    this.name = 'RedirectRefusedError';
  }
}

export interface HttpClient {
  readonly base: string;
  readonly api: ApiFn;
  upload(productId: string, png: Buffer): Promise<void>;
  cookieHeader(): string;
  csrfToken(): string | undefined;
}

const isRedirectFailure = (error: unknown): boolean => {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return /redirect/i.test(cause instanceof Error ? cause.message : String(cause ?? '')) || /redirect/i.test(error instanceof Error ? error.message : '');
};

export interface HttpClientOptions {
  /**
   * B1 (D-8E.26-B4.5). A read-only client performs GET requests and the one POST of the login, nothing else — in particular no upload. It is
   * enforced here, in `send` (the single place that touches the network), so it does not depend on what the caller does or does not reach.
   */
  readonly readOnly?: boolean;
  /** The path of the login, the only POST a read-only client may send. */
  readonly loginPath?: string;
}

export const DEFAULT_LOGIN_PATH = '/api/v1/auth/login';

export function createHttpClient(base: string, fetchImpl: FetchLike = (input, init) => fetch(input, init), options: HttpClientOptions = {}): HttpClient {
  const loginPath = options.loginPath ?? DEFAULT_LOGIN_PATH;
  const jar = new Map<string, string>();

  const absorb = (response: Response): void => {
    const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const cookie of raw) {
      const [pair] = cookie.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (!pair || eq === -1) continue;
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const cookieHeader = (): string => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  /** The ONLY place that performs a request. `redirect: 'error'` comes last so it cannot be overridden by `init`. */
  async function send(method: string, urlPath: string, init: RequestInit): Promise<Response> {
    if (options.readOnly === true && method !== 'GET' && !(method === 'POST' && urlPath === loginPath)) {
      throw new SeedGuardError(`A write was attempted through a read-only client: ${method} ${urlPath}`);
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${urlPath}`, { ...init, method, redirect: 'error' });
    } catch (error) {
      if (isRedirectFailure(error)) throw new RedirectRefusedError(method, urlPath);
      throw new Error(`${method} ${urlPath} failed: the request did not complete.`);
    }
    absorb(response);
    if (response.status >= 300 && response.status < 400) throw new RedirectRefusedError(method, urlPath);
    return response;
  }

  const api = (async (method: string, urlPath: string, body?: unknown, opts: { idempotent?: boolean } = {}) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size > 0) headers['cookie'] = cookieHeader();
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = jar.get('csrf_token');
      if (csrf) headers['x-csrf-token'] = csrf;
      if (opts.idempotent) headers['idempotency-key'] = randomUUID();
    }
    const response = await send(method, urlPath, { headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 200); // the response only; never the request
      throw new Error(`${method} ${urlPath} -> ${String(response.status)}: ${text}`);
    }
    if (response.status === 204) return undefined;
    return (await response.json()) as unknown;
  }) as ApiFn;

  async function upload(productId: string, png: Buffer): Promise<void> {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'placeholder.png');
    const headers: Record<string, string> = {};
    if (jar.size > 0) headers['cookie'] = cookieHeader();
    const csrf = jar.get('csrf_token');
    if (csrf) headers['x-csrf-token'] = csrf;
    const urlPath = `/api/v1/products/${productId}/images`;
    const response = await send('POST', urlPath, { headers, body: form });
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`POST ${urlPath} -> ${String(response.status)}: ${text}`);
    }
  }

  return { base, api, upload, cookieHeader, csrfToken: () => jar.get('csrf_token') };
}
