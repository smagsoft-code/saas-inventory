import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createHttpClient, RedirectRefusedError, type FetchLike } from './qa-http-client';
import { runQaSeed } from './qa-seed';
import { SeedGuardError, type SeedConfig } from './qa-seed-guards';

/**
 * M1 (D-8E.26-B4.3): the CLI must never follow a redirect. These tests drive the REAL client with a fake `fetch` that implements the
 * WHATWG redirect modes (`follow`, `manual`, `error`) for 301/302/303/307/308, so what is asserted is the client's behaviour: which
 * requests actually went out and where. No socket is opened and no service is contacted.
 */

const BASE = 'http://127.0.0.1:4000';
const EVIL = 'https://evil.example';
// A throwaway marker used only to prove it is never repeated in a message. It is not a credential of any system.
const PASSWORD = `pw-${'x'.repeat(10)}-sample`;
const LOGIN = '/api/v1/auth/login';
type RedirectStatus = 301 | 302 | 303 | 307 | 308;
const STATUSES: RedirectStatus[] = [301, 302, 303, 307, 308];

interface Seen {
  url: string;
  method: string;
  body: unknown;
  redirect: RequestInit['redirect'] | undefined;
}

/** A local "API" that answers every request under BASE with a redirect to a remote host (and sets a session cookie), emulating fetch. */
function redirectingFetch(status: RedirectStatus, answersOk?: (url: string) => boolean): { impl: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const impl: FetchLike = async (input, init) => {
    seen.push({ url: input, method: init.method ?? 'GET', body: init.body, redirect: init.redirect });
    if (input.startsWith(EVIL)) return new Response('{"collected":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    if (answersOk?.(input)) {
      return new Response(JSON.stringify({ status: 'authenticated', user: { tenantSlug: 'qa-dev-tenant', status: 'active' } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'session=SECRETSESSION; Path=/' },
      });
    }
    const mode = init.redirect ?? 'follow';
    if (mode === 'error') throw Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') });
    const redirect = new Response(null, { status, headers: { location: `${EVIL}/collect`, 'set-cookie': 'session=SECRETSESSION; Path=/' } });
    if (mode === 'manual') return redirect;
    const keepMethod = status === 307 || status === 308;
    const withoutBody = { ...init };
    delete withoutBody.body; // 301/302/303 turn the request into a GET without a body
    return impl(`${EVIL}/collect`, keepMethod ? { ...init, method: init.method ?? 'POST', redirect: mode } : { ...withoutBody, method: 'GET', redirect: mode });
  };
  return { impl, seen };
}

const contactedRemote = (seen: Seen[]): boolean => seen.some((s) => s.url.startsWith(EVIL));
const messageIsClean = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return !message.includes(PASSWORD) && !message.includes('SECRETSESSION') && !/cookie|authorization|set-cookie|x-csrf/i.test(message);
};

describe('M1 — the CLI never follows a redirect', () => {
  for (const status of STATUSES) {
    it(`${String(status)} on the login: the request is refused, nothing reaches the redirect target, the run stops`, async () => {
      const { impl, seen } = redirectingFetch(status);
      const client = createHttpClient(BASE, impl);
      await assert.rejects(client.api('POST', LOGIN, { email: 'qa-admin@dev.local', password: PASSWORD }), (error: unknown) => {
        assert.ok(error instanceof RedirectRefusedError);
        assert.ok(messageIsClean(error), 'the error names no password, cookie or header');
        return true;
      });
      assert.equal(seen.length, 1, 'exactly one request: no second request to the redirected destination');
      assert.equal(contactedRemote(seen), false);
      assert.equal(seen[0]?.redirect, 'error');
      assert.ok(seen[0]?.url.startsWith(BASE));
    });
  }

  it('the control: WITHOUT the protection the same 307/308 would have delivered the login body (with the password) to the remote host', async () => {
    for (const status of [307, 308] as const) {
      const { impl, seen } = redirectingFetch(status);
      await impl(`${BASE}${LOGIN}`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) }); // fetch default: follow
      const second = seen.find((s) => s.url.startsWith(EVIL));
      assert.ok(second, `${String(status)} is followed by default`);
      assert.equal(second.method, 'POST');
      assert.ok(String(second.body).includes(PASSWORD), 'the body — the credentials — reached the other host');
    }
    for (const status of [301, 302, 303] as const) {
      const { impl, seen } = redirectingFetch(status);
      await impl(`${BASE}${LOGIN}`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
      assert.equal(seen.find((s) => s.url.startsWith(EVIL))?.method, 'GET', 'the body is dropped, but the redirect is still followed');
    }
  });

  it('the protection cannot be switched off: every request of the client carries redirect "error"', async () => {
    const { impl, seen } = redirectingFetch(307, (url) => url.startsWith(BASE)); // answers 200 for everything under BASE
    const client = createHttpClient(BASE, impl);
    await client.api('POST', LOGIN, { email: 'a@dev.local', password: PASSWORD });
    await client.api('GET', '/api/v1/tenant');
    await client.api('POST', '/api/v1/cart', { x: 1 }, { idempotent: true });
    await client.upload('prod-1', Buffer.from('png'));
    assert.equal(seen.length, 4);
    assert.ok(seen.every((s) => s.redirect === 'error'));
    assert.ok(seen.every((s) => s.url.startsWith(BASE)));
  });

  it('the image upload is protected too: a 307 on the multipart POST is refused and goes nowhere', async () => {
    const { impl, seen } = redirectingFetch(307);
    const client = createHttpClient(BASE, impl);
    await assert.rejects(client.upload('prod-1', Buffer.from('png')), RedirectRefusedError);
    assert.equal(seen.length, 1);
    assert.equal(contactedRemote(seen), false);
    assert.equal(seen[0]?.redirect, 'error');
  });

  it('a 3xx that still arrives as a response (a fetch that did not honour "error") is refused anyway', async () => {
    const stubborn: FetchLike = () => Promise.resolve(new Response(null, { status: 302, headers: { location: `${EVIL}/x` } }));
    const client = createHttpClient(BASE, stubborn);
    await assert.rejects(client.api('GET', '/api/v1/tenant'), RedirectRefusedError);
    await assert.rejects(client.upload('prod-1', Buffer.from('png')), RedirectRefusedError);
  });

  it('inside a seed run: a redirect on the first data request stops the run — no later request, remote never contacted, messages clean', async () => {
    const { impl, seen } = redirectingFetch(308, (url) => url.endsWith(LOGIN)); // login answers 200 and sets a cookie; everything else redirects
    const client = createHttpClient(BASE, impl);
    const config: SeedConfig = { mode: 'normal', yes: true, tenantSlug: 'qa-dev-tenant', apiBase: BASE };
    const logs: string[] = [];
    await assert.rejects(
      runQaSeed({
        api: client.api,
        login: () => client.api('POST', LOGIN, { email: 'qa-admin@dev.local', password: PASSWORD }),
        uploadImage: (id) => client.upload(id, Buffer.from('png')),
        config,
        log: (line) => logs.push(line),
      }),
      (error: unknown) => {
        assert.ok(error instanceof RedirectRefusedError);
        assert.ok(messageIsClean(error));
        return true;
      },
    );
    assert.deepEqual(seen.map((s) => s.url.replace(BASE, '')), [LOGIN, '/api/v1/tenant'], 'login, the first data request, and nothing else');
    assert.equal(contactedRemote(seen), false);
    assert.ok(logs.every((line) => !line.includes(PASSWORD) && !line.includes('SECRETSESSION')));
  });

  it('an HTTP error message carries the response status and a truncated response body, never the request', async () => {
    const failing: FetchLike = () => Promise.resolve(new Response('x'.repeat(500), { status: 500 }));
    const client = createHttpClient(BASE, failing);
    await assert.rejects(client.api('POST', LOGIN, { email: 'a@dev.local', password: PASSWORD }), (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /POST \/api\/v1\/auth\/login -> 500/);
      assert.ok(message.length < 260, 'the response body is truncated');
      assert.ok(messageIsClean(error));
      return true;
    });
  });

  it('a network failure reports neither the URL parameters nor the request', async () => {
    const broken: FetchLike = () => Promise.reject(new Error(`connect ECONNREFUSED with body ${PASSWORD}`));
    const client = createHttpClient(BASE, broken);
    await assert.rejects(client.api('POST', LOGIN, { password: PASSWORD }), (error: unknown) => messageIsClean(error) && !(error instanceof RedirectRefusedError));
  });

  it('B1: a read-only client sends GET and the login POST only; an upload or any other write never reaches the network', async () => {
    const seen: string[] = [];
    const impl: FetchLike = (input, init) => {
      seen.push(`${init.method ?? 'GET'} ${input.replace(BASE, '')}`);
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const client = createHttpClient(BASE, impl, { readOnly: true });
    await client.api('POST', LOGIN, { email: 'a@dev.local', password: PASSWORD });
    await client.api('GET', '/api/v1/tenant');
    const attempts: Array<() => Promise<unknown>> = [
      () => client.upload('prod-1', Buffer.from('png')),
      () => client.api('POST', '/api/v1/products', { name: 'x' }),
      () => client.api('POST', '/api/v1/auth/login-extra', {}),
      () => client.api('PATCH', '/api/v1/products/p', {}),
      () => client.api('PUT', '/api/v1/x', {}),
      () => client.api('DELETE', '/api/v1/products/p'),
    ];
    for (const attempt of attempts) {
      await assert.rejects(attempt(), (error: unknown) => {
        assert.ok(error instanceof SeedGuardError);
        assert.match((error as Error).message, /read-only client/);
        assert.ok(messageIsClean(error));
        return true;
      });
    }
    assert.deepEqual(seen, [`POST ${LOGIN}`, 'GET /api/v1/tenant'], 'only the login and the GET were sent');
  });
  it('B1: a client that is not read-only still uploads (the normal writing run is unchanged)', async () => {
    const seen: string[] = [];
    const impl: FetchLike = (input, init) => {
      seen.push(`${init.method ?? 'GET'} ${input.replace(BASE, '')}`);
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    await createHttpClient(BASE, impl).upload('prod-1', Buffer.from('png'));
    assert.deepEqual(seen, ['POST /api/v1/products/prod-1/images']);
  });
  it('static: the only network call of the CLI is the single guarded one in qa-http-client.ts', () => {
    const read = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
    const client = read('qa-http-client.ts');
    assert.equal((client.match(/await fetchImpl\(/g) ?? []).length, 1, 'one request site');
    assert.equal((client.match(/\.\.\.init, method, redirect: 'error'/g) ?? []).length, 1, 'redirect "error" forced after the caller\'s options');
    assert.equal((client.match(/redirect: '(follow|manual)'/g) ?? []).length, 0);
    for (const name of ['seed-qa-data.ts', 'qa-seed.ts', 'qa-seed-guards.ts', 'qa-credentials.ts']) {
      assert.equal(/\bfetch\s*\(/.test(read(name)), false, `${name} must not call fetch directly`);
      assert.equal(/redirect\s*:\s*['"](follow|manual)['"]/.test(read(name)), false);
    }
  });
});
