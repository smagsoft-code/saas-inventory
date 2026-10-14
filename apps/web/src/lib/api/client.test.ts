import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';
import { ApiError } from './errors';
import { PLATFORM_SESSION_EXPIRED_EVENT, SESSION_EXPIRED_EVENT } from '../auth/session-events';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const REFRESH = '/api/v1/auth/refresh';

describe('apiFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = '';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the parsed JSON body on success', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { hello: 'world' })) as typeof fetch;
    await expect(apiFetch('/api/v1/auth/me')).resolves.toEqual({ hello: 'world' });
  });

  it('returns undefined for a 204 / empty body', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(204, undefined)) as typeof fetch;
    await expect(apiFetch('/api/v1/users/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws a normalized ApiError from the backend envelope', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(409, {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Nope.',
          correlationId: 'abc',
        }),
      )
      .mockName('fetch') as typeof fetch;

    await expect(apiFetch('/api/v1/orders', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Nope.',
      correlationId: 'abc',
    });
  });

  it('sends no body on GET, a JSON body + credentials on POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    global.fetch = fetchMock as typeof fetch;

    await apiFetch('/api/v1/auth/me');
    const [, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(getInit).not.toHaveProperty('body');

    await apiFetch('/api/v1/auth/register', { method: 'POST', body: { email: 'a@b.com' } });
    const [, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postInit.body).toBe(JSON.stringify({ email: 'a@b.com' }));
    expect(postInit.credentials).toBe('include');
  });

  it('merges caller-supplied headers (e.g. Idempotency-Key) without dropping the defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    global.fetch = fetchMock as typeof fetch;

    await apiFetch('/api/v1/inventory/transfers/t1/receive', {
      method: 'POST',
      body: { items: [] },
      headers: { 'Idempotency-Key': 'key-abc' },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('key-abc');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Correlation-Id']).toBeTruthy();
  });

  it('omits Content-Type on a bodyless mutation (e.g. POST /orders/:id/confirm) — Fastify 500s on JSON content-type with an empty body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    global.fetch = fetchMock as typeof fetch;

    await apiFetch('/api/v1/orders/o1/confirm', { method: 'POST' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init).not.toHaveProperty('body');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>)['Correlation-Id']).toBeTruthy();
  });

  it('sends a FormData body as-is and lets the browser set the multipart Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'job-1' }));
    global.fetch = fetchMock as typeof fetch;

    const form = new FormData();
    form.set('file', new File(['x'], 'a.xlsx'));
    await apiFetch('/api/v1/imports', { method: 'POST', body: form });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>)['Correlation-Id']).toBeTruthy();
  });

  it('translates a network failure into a status-0 ApiError', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as typeof fetch;
    const error = await apiFetch('/api/v1/auth/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  describe('401 handling', () => {
    it('refreshes once and retries the original request once on success', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' })) // original
        .mockResolvedValueOnce(jsonResponse(200, {})) // refresh
        .mockResolvedValueOnce(jsonResponse(200, { ok: true })); // retry
      global.fetch = fetchMock as typeof fetch;

      await expect(apiFetch('/api/v1/users')).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[1] as [string])[0]).toContain(REFRESH);
    });

    it('emits session-expired and throws when the refresh also fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
        .mockResolvedValueOnce(jsonResponse(401, { message: 'no refresh' }));
      global.fetch = fetchMock as typeof fetch;

      const spy = vi.fn();
      window.addEventListener(SESSION_EXPIRED_EVENT, spy);
      await expect(apiFetch('/api/v1/users')).rejects.toBeInstanceOf(ApiError);
      window.removeEventListener(SESSION_EXPIRED_EVENT, spy);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('never refreshes on a 403', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(403, { code: 'FORBIDDEN', message: 'no' }));
      global.fetch = fetchMock as typeof fetch;
      await expect(apiFetch('/api/v1/users')).rejects.toMatchObject({ status: 403 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never refreshes the refresh call itself', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: 'no' }));
      global.fetch = fetchMock as typeof fetch;
      await expect(apiFetch(REFRESH, { method: 'POST' })).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('GAP-SA-PLATFORM-401: a platform-scoped 401 refreshes against /platform/auth/refresh, never the tenant endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' })) // original
        .mockResolvedValueOnce(jsonResponse(200, {})) // platform refresh
        .mockResolvedValueOnce(jsonResponse(200, { ok: true })); // retry
      global.fetch = fetchMock as typeof fetch;

      await expect(apiFetch('/api/v1/platform/tenants/t1/activate', { method: 'POST' })).resolves.toEqual({
        ok: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const refreshUrl = (fetchMock.mock.calls[1] as [string])[0];
      expect(refreshUrl).toContain('/api/v1/platform/auth/refresh');
      expect(refreshUrl).not.toBe(REFRESH);
    });

    it('GAP-SA-PLATFORM-401: emits platform-session-expired (not the tenant event) when the platform refresh also fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
        .mockResolvedValueOnce(jsonResponse(401, { message: 'no refresh' }));
      global.fetch = fetchMock as typeof fetch;

      const platformSpy = vi.fn();
      const tenantSpy = vi.fn();
      window.addEventListener(PLATFORM_SESSION_EXPIRED_EVENT, platformSpy);
      window.addEventListener(SESSION_EXPIRED_EVENT, tenantSpy);
      await expect(apiFetch('/api/v1/platform/tenants/t1/suspend', { method: 'POST' })).rejects.toBeInstanceOf(
        ApiError,
      );
      window.removeEventListener(PLATFORM_SESSION_EXPIRED_EVENT, platformSpy);
      window.removeEventListener(SESSION_EXPIRED_EVENT, tenantSpy);
      expect(platformSpy).toHaveBeenCalledTimes(1);
      expect(tenantSpy).not.toHaveBeenCalled();
    });

    it('never refreshes the platform refresh call itself', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: 'no' }));
      global.fetch = fetchMock as typeof fetch;
      await expect(
        apiFetch('/api/v1/platform/auth/refresh', { method: 'POST' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('deduplicates a concurrent refresh (single-flight)', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes(REFRESH)) {
          return Promise.resolve(jsonResponse(200, {}));
        }
        // both originals 401 first, then 200 on retry
        return Promise.resolve(jsonResponse(fetchMock.mock.calls.length <= 2 ? 401 : 200, {}));
      });
      global.fetch = fetchMock as typeof fetch;

      await Promise.all([apiFetch('/api/v1/a'), apiFetch('/api/v1/b')]);
      const refreshCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes(REFRESH));
      expect(refreshCalls).toHaveLength(1);
    });
  });
});
