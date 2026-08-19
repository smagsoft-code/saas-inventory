# Frontend Architecture

Related: [ADR-0006](../decisions/0006-nextjs.md). No functional pages are built in this phase —
this defines the shape `apps/web` follows once auth and business modules exist.

## App Router structure

Route groups separate areas with different layout/auth requirements, so each area's layout owns
exactly the chrome and guards it needs:

```text
apps/web/src/app/
├── (public)/              Marketing/landing, login, register — no session required
│   └── layout.tsx
├── (tenant)/              Authenticated tenant-user area
│   ├── layout.tsx         Enforces session + tenant context, renders app shell/nav
│   └── .../               Feature routes, added as modules are built
├── (superadmin)/          Authenticated SuperAdmin area
│   └── layout.tsx         Enforces SuperAdmin session — structurally separate from (tenant)
└── layout.tsx             Root layout (already scaffolded: apps/web/src/app/layout.tsx)
```

Mirroring [multi-tenancy.md](multi-tenancy.md#superadmin-vs-tenant), the SuperAdmin area is a
structurally separate route group with its own layout/guard, not a role-check inside the tenant
layout — the frontend should not be the place where "is this a SuperAdmin" and "is this a tenant
admin" can be confused either.

## Authentication and route protection

The frontend never makes an authorization decision that matters — the API is the authority (per
[CLAUDE.md §7.6](../../CLAUDE.md#76-frontend)). Route protection in Next.js exists for UX (don't
show a logged-out user the app shell, don't flash a screen the user's role can't use), not as a
security boundary; the API re-checks authorization on every request regardless of what the
frontend rendered.

**How the session is carried between browser and API is a `PENDING DECISION`**, between:

- An **httpOnly, secure, `SameSite` cookie** set by the API on login, containing the access token
  (or a session identifier). The browser never has JS-readable access to it, which removes XSS
  token theft as a risk (see [security.md](security.md)) — the tradeoff is CSRF becomes a concern
  the API must defend against (see [security.md](security.md#csrf)) and cross-origin mobile clients
  can't reuse this exact mechanism.
- A **bearer JWT returned in the response body**, held in memory (not `localStorage`, to limit XSS
  exposure) by the frontend and sent as an `Authorization` header. Works uniformly for web and
  future mobile clients, but reintroduces "don't let anything read this token" as a frontend
  concern and typically needs a silent-refresh flow.

This is decided when authentication is actually designed (see
[roadmap.md](../roadmap/roadmap.md) FASE 4), informed by how the mobile apps end up authenticating
too. Either way, [security.md](security.md#authentication) fixes the token *issuance* rules (short-
lived access token, longer-lived refresh token, rotation) independent of this transport choice.

Route protection itself is implemented at the layout level per route group (redirect to `(public)`
login if no valid session) plus, where Next.js middleware is used for an early redirect, the
middleware only reads session presence — it does not itself decide fine-grained authorization,
which stays server-side in the API.

## API client

A single, thin API client wraps `fetch`:

- Resolves the API base URL from `API_URL` (server-side) — never hardcoded, never a secret (it's a
  public URL, not a credential).
- Attaches the auth token/cookie per the mechanism decided above.
- Generates or forwards a `correlationId` per request (see [api.md](api.md#correlation-id)) so a
  frontend error can be traced to the exact backend request.
- Normalizes API error responses into a typed error the UI layer can branch on (see
  [Error, loading, and empty states](#error-loading-and-empty-states)).

Server Components call the API directly on the server (no token exposed to the browser for that
fetch); Client Components go through the same client but the call leaves the browser, so whichever
session-transport mechanism is chosen must work from both contexts.

## Server vs Client Components

Default to Server Components for data fetching and initial render — it keeps data-fetching logic
off the client bundle and close to the API call. Client Components are used specifically for
interactivity (forms, anything with local state, anything using browser-only APIs). This is a
default, not a rule enforced mechanically — individual routes choose based on what they need once
they're built.

## State, forms, and validation

- Server state (data from the API) is fetched where it's used (Server Components / route loaders),
  not duplicated into a global client store by default.
- Client-local UI state (form state, open/closed toggles) uses React's built-in state — no global
  state library is adopted speculatively; one is introduced only if a concrete cross-route client
  state need shows up.
- Forms validate against the same shape the API's DTOs expect, so a validation error surfaces
  consistently whether it's caught client-side (fast feedback) or returned by the API (source of
  truth) — exact form/validation libraries are an implementation choice made when the first real
  form (e.g. login) is built, not fixed here.

## Error, loading, and empty states

Per [CLAUDE.md §7.6](../../CLAUDE.md#76-frontend), every data-driven view handles three states
explicitly, not just the happy path:

- **Loading** — a route/component fetching data shows a loading state (Next.js `loading.tsx` for
  route-level, local state for component-level), not a blank screen.
- **Error** — an API error (including a network failure) is caught and shown as an actionable
  message (Next.js `error.tsx` for route-level boundaries), including the `correlationId` where
  it's useful for support, never a raw stack trace or raw API error body.
- **Empty** — "the request succeeded and there is legitimately no data" is a distinct state from
  loading and error, with its own UI (e.g. "no products yet" with a call to action), not an empty
  table that looks broken.

## Accessibility and responsiveness

Semantic HTML, labeled form controls, keyboard-navigable interactive elements, and visible focus
states are baseline requirements for every component built, not a pass done at the end. Layouts
are responsive (mobile-first where the audience plausibly includes tablet/phone use, e.g. a
warehouse worker scanning QR codes on a phone) rather than desktop-only.

## What this phase does not decide

No pages, components, or auth implementation exist yet. Session-transport mechanism, form/validation
libraries, and any client state library are decided when the modules that need them are actually
built.
