import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

function req(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(new URL(`http://localhost${path}`), {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

/** `NextResponse.next()` carries this header; a redirect does not. */
function isPassThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1';
}

describe('middleware — route protection (UX only)', () => {
  describe('tenant context', () => {
    it('lets /login and /register through unauthenticated', () => {
      expect(isPassThrough(middleware(req('/login')))).toBe(true);
      expect(isPassThrough(middleware(req('/register')))).toBe(true);
    });

    it('redirects an authenticated tenant route to /login with returnTo when no access_token', () => {
      const res = middleware(req('/users'));
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/login');
      expect(loc.searchParams.get('returnTo')).toBe('/users');
    });

    it('lets an authenticated tenant route through when access_token is present', () => {
      expect(isPassThrough(middleware(req('/users', { access_token: 'x' })))).toBe(true);
    });
  });

  describe('platform context', () => {
    it('lets /platform/login through unauthenticated', () => {
      expect(isPassThrough(middleware(req('/platform/login')))).toBe(true);
    });

    it('redirects /platform to /platform/login (no returnTo for the root)', () => {
      const res = middleware(req('/platform'));
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/platform/login');
      expect(loc.searchParams.has('returnTo')).toBe(false);
    });

    it('redirects a deeper /platform route to /platform/login with returnTo', () => {
      const res = middleware(req('/platform/tenants'));
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/platform/login');
      expect(loc.searchParams.get('returnTo')).toBe('/platform/tenants');
    });

    it('lets a platform route through when platform_access_token is present', () => {
      expect(isPassThrough(middleware(req('/platform', { platform_access_token: 'x' })))).toBe(true);
    });

    it('does not accept a tenant access_token for a platform route', () => {
      const res = middleware(req('/platform', { access_token: 'x' }));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname).toBe('/platform/login');
    });

    it('does not accept a platform_access_token for a tenant route', () => {
      const res = middleware(req('/users', { platform_access_token: 'x' }));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    });
  });
});
