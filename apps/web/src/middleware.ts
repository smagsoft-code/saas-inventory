import { NextResponse, type NextRequest } from 'next/server';

/**
 * UX-only early redirect (Prompt 016 §38 / frontend.md / F17-01 §13): if the required session
 * cookie is absent, an authenticated route sends the browser straight to the right login page
 * instead of rendering a shell that would immediately bounce. This is NOT authorization — it only
 * checks cookie *presence*, never validity or permissions; the API re-checks everything, and each
 * layout still calls its `/…/me` endpoint.
 *
 * Two independent contexts, never mixed (multi-tenancy.md#superadmin-vs-tenant):
 *  - `/platform/*`  → the platform-admin area, gated on `platform_access_token`, login at
 *    `/platform/login`.
 *  - everything else → the tenant area, gated on `access_token`, login at `/login`.
 */
const TENANT_PUBLIC_PATHS = new Set(['/login', '/register']);
const PLATFORM_LOGIN_PATH = '/platform/login';

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // --- platform-admin context ---------------------------------------------------------------
  if (pathname === PLATFORM_LOGIN_PATH) {
    return NextResponse.next();
  }
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    if (request.cookies.has('platform_access_token')) {
      return NextResponse.next();
    }
    const loginUrl = new URL(PLATFORM_LOGIN_PATH, request.url);
    const returnTo = `${pathname}${search}`;
    if (returnTo !== '/platform') {
      loginUrl.searchParams.set('returnTo', returnTo);
    }
    return NextResponse.redirect(loginUrl);
  }

  // --- tenant context ----------------------------------------------------------------------
  if (TENANT_PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }
  if (request.cookies.has('access_token')) {
    return NextResponse.next();
  }
  const loginUrl = new URL('/login', request.url);
  const returnTo = `${pathname}${search}`;
  if (returnTo !== '/') {
    loginUrl.searchParams.set('returnTo', returnTo);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next internals, static assets, and the API proxy (which must reach the
  // backend so the browser can authenticate in the first place).
  matcher: ['/((?!_next/static|_next/image|api/|favicon.ico|.*\\.[^/]+$).*)'],
};
