import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api-client';

describe('apiFetch', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_API_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns the parsed JSON body on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ hello: 'world' }),
    }) as unknown as typeof fetch;

    await expect(apiFetch('/api/v1/auth/me')).resolves.toEqual({ hello: 'world' });
  });

  it('throws an ApiError with the server-provided shape on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired session.', correlationId: 'abc' }),
    }) as unknown as typeof fetch;

    await expect(apiFetch('/api/v1/auth/me')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session.',
      correlationId: 'abc',
    });
  });

  it('falls back to a generic message if the error body is not the expected shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' }) as unknown as typeof fetch;

    const error = await apiFetch('/api/v1/auth/me').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Something went wrong. Please try again.');
  });

  it('never sends a body on a GET request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiFetch('/api/v1/auth/me');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init).not.toHaveProperty('body');
  });

  it('sends a JSON body for a POST request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '{}' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiFetch('/api/v1/auth/register', { method: 'POST', body: { email: 'a@b.com' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.com' }));
    expect(init.credentials).toBe('include');
  });
});
