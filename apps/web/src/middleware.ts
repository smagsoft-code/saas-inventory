import { NextResponse, type NextRequest } from 'next/server';

/**
 * UX-only early redirect (Prompt 016 §38 / frontend.md): if there is no `access_token` cookie at
 * all, an authenticated route sends the browser straight to `/login?returnTo=…` instead of
 * rendering a shell that would immediately bounce. This is NOT authorization — it only checks
 * cookie *presence*, never validity or permissions; the API re-checks everything, and the layout
 * still calls `/auth/me`. An expired access token that the browser has dropped lands here too, and
 * `login-form.tsx` then attempts a silent refresh before showing the form.
 */
const PUBLIC_PATHS = new Set(['/login', '/register']);

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const hasAccessToken = request.cookies.has('access_token');
  if (hasAccessToken) {
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
