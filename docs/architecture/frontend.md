# Frontend Architecture

Related: [ADR-0006](../decisions/0006-nextjs.md). FASE 16 implemented the reusable foundation
described here; FASE 17 builds the business modules on top of it. The frontend is never a security
boundary — the API re-checks authentication and authorization on every request
([CLAUDE.md §7.6](../../CLAUDE.md#76-frontend)).

## App Router structure

Route groups separate areas with different layout/auth requirements:

```text
apps/web/src/
├── middleware.ts            Presence-only redirect for obviously-unauthenticated navigations (UX)
└── app/
    ├── (public)/            Login, register — no session required
    │   ├── layout.tsx
    │   ├── login/           login-form.tsx: returnTo + one silent refresh before showing the form
    │   └── register/
    ├── (tenant)/            Authenticated tenant-user area
    │   ├── layout.tsx       getSession() gate → <AppShell> with session + filtered navigation
    │   ├── loading.tsx      Skeleton (never a blank screen)
    │   ├── error.tsx        <ErrorState> (correlationId, no stack trace)
    │   ├── not-found.tsx    Generic — never reveals whether a protected resource exists
    │   ├── page.tsx         Dashboard (owns "/")
    │   ├── settings/        GET/PATCH /tenant
    │   └── users/           GET/POST /users, GET/PATCH /users/:id, GET /roles
    ├── layout.tsx           Root layout
    ├── not-found.tsx        Global 404
    └── global-error.tsx     Last-resort boundary (renders its own <html>/<body>)
```

The `(superadmin)` area is a future, structurally separate route group with its own layout/guard
(mirroring [multi-tenancy.md](multi-tenancy.md#superadmin-vs-tenant)) — not built in FASE 16, and
never a role-check inside the tenant layout.

## Transport / same-origin

`next.config.ts` rewrites `/api/*` to `API_URL`. The browser therefore always talks to its own
origin under `/api/*` and session cookies are first-party in every environment — the same shape
the Caddy reverse proxy gives production (`/api/*` → api, `/*` → web —
[docs/deployment/docker.md](../deployment/docker.md)). `NEXT_PUBLIC_API_URL` remains only as an
override for a genuinely cross-origin deployment whose CORS + cookie flags are configured for it.

## Authentication and route protection

**Session transport (Prompt 04, [ADR-0030](../decisions/0030-authentication-foundation.md)):** an
httpOnly, `Secure` (outside dev), `SameSite=Lax` `access_token` cookie, a path-restricted
(`/api/v1/auth`) httpOnly `refresh_token` cookie, and a non-httpOnly `csrf_token` for the
double-submit header (`common/guards/csrf.guard.ts`). The browser never has JS access to the
session tokens.

**Server side:** `lib/auth/session.ts`'s `getSession()` is a React `cache()`-deduped
`GET /auth/me` — one round-trip per request, shared by the layout and every nested Server
Component. The `(tenant)` layout redirects to `/login` when it returns `null` (a genuine 401);
any other failure propagates to `error.tsx` so a transient API outage does not look like "logged
out". `middleware.ts` additionally short-circuits a navigation that carries no `access_token`
cookie at all — a UX optimisation, checking presence only, never validity or permissions.

**Session expiry / refresh:** see [API client](#api-client). When a hard navigation lands on an
expired access token but a still-valid refresh token, `login-form.tsx` attempts **one** silent
`POST /auth/refresh` (guarded against loops via `sessionStorage`) before rendering the form, so
the user is bounced back to where they were without ever seeing private content flash.

**Logout** (`lib/auth/use-logout.ts`) calls `POST /auth/logout` (real backend revocation), then
`router.replace('/login')` + `router.refresh()`.

## API client

`lib/api/` is the single client. `apiFetch` is used from both contexts — Server Components via
`serverApiFetch` (`lib/api/server.ts`, forwards `cookies()`), Client Components directly
(`credentials: 'include'`, plus the `X-CSRF-Token` header on mutations). It:

- resolves the base URL — `API_URL` on the server, same-origin (empty) on the browser;
- generates a `Correlation-Id` header per request ([api.md](api.md#correlation-id));
- normalizes every non-2xx response into an `ApiError` (`lib/api/errors.ts`:
  `status`/`code`/`message`/`correlationId`, `status: 0` for a network failure) — matching the
  backend envelope from `common/filters/http-exception.filter.ts` exactly, inventing no fields;
- exposes `httpErrorMessage()` — a short per-status sentence that **never** echoes a 5xx body;
- handles empty (204) bodies and accepts an `AbortSignal` and a `query` object.

**401 handling (Prompt 016 §8):** on the browser only, a 401 triggers **one** `POST /auth/refresh`
(deduplicated across concurrent callers by a module-level in-flight promise) and **one** retry of
the original request. It never refreshes on 403/400/404/409/422/429/5xx, never the refresh call
itself, and never more than once per request. A failed refresh emits a single `session-expired`
event; `components/shell/session-expiry-listener.tsx` (one instance, in the shell) redirects to
`/login?returnTo=…` with an open-redirect-safe path (`lib/auth/return-to.ts`).

## Permissions

`lib/auth/permissions.ts`'s `createPermissionChecker(session.permissions)` returns
`can` / `canAny` / `canAll` over the exact codes `GET /auth/me` returned. `permission-codes.ts`
mirrors the backend's recognised codes (authority: `packages/shared` `DEFAULT_ROLE_TEMPLATES` +
the `*_permissions` migrations). The navigation registry (`lib/navigation.ts`) is
permission-filtered server-side; pages hide actions the user cannot perform. None of this is
enforcement — a 403 that comes back anyway is handled as a normal error (§15).

## Application shell

`components/shell/app-shell.tsx` — a persistent sidebar on `lg+`, a slide-over drawer on smaller
screens (Esc / overlay / route-change close, body-scroll lock), a sticky header showing the
tenant name with an accessible account menu (name / email / tenant / real logout). It hosts the
single `SessionProvider` (`useSession()` / `usePermissions()` for Client Components) and
`SessionExpiryListener` for the authenticated tree. Navigation lives in one registry
(`lib/navigation.ts`) — items reference only routes that exist; future modules are not listed as
links until built.

## UI foundation

`components/ui/` — Button / ButtonLink, Input / Select / Textarea, Field (label + hint + error id
wiring), Card, Alert, Badge, Spinner, Skeleton, EmptyState, ErrorState, PageHeader,
PageContainer. Small and composed; real `<button>`/`<a>` elements, labeled controls, visible
focus. No component library or CSS-solution change — Tailwind, as before.

## Server vs Client Components

Default to Server Components for data fetching and initial render; `"use client"` only for
interactivity (forms, menus, drawer state, anything reading browser APIs). Filtered navigation and
the session are computed in the Server layout and passed to the shell as plain data — no function
or secret crosses into the client bundle.

## State, forms, and validation

Server state is fetched where used, not mirrored into a global store. Client-local UI state uses
React's built-ins — no global state library, no data-fetching library, no form library was
adopted (frontend.md's original position holds: the current forms need only React state + the
API's own DTO validation errors, surfaced through `httpErrorMessage`).

## Error, loading, and empty states

Every data-driven view handles all three (CLAUDE.md §7.6): route-level `loading.tsx` (skeleton)
and `error.tsx` (`<ErrorState>` with `correlationId`, retry, no raw stack), and `<EmptyState>`
for "succeeded, no data" with an optional permission-gated call to action.

## Accessibility and responsiveness

Semantic HTML, labeled controls, keyboard-operable menus/drawer (Esc, focus return, `aria-*`
only where it earns its place), visible focus, and a mobile-first shell — baseline for every
component, not a final pass.
