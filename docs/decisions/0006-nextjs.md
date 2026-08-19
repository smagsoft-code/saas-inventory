# ADR-0006: Next.js for the Web Frontend

## Status

Accepted

## Context

The web app needs server-rendering (for performance and SEO on any public-facing pages), a React
component model (for the team's existing familiarity and ecosystem), and a clear place to keep API
calls off the client where that matters for security (e.g. not exposing more than necessary to the
browser). See [frontend.md](../architecture/frontend.md).

## Decision

Next.js (App Router), React, TypeScript, Tailwind CSS — set in the approved stack in Prompt 00;
this ADR records the architectural fit. The App Router's route groups are used to structurally
separate public, tenant, and SuperAdmin areas — see
[frontend.md#app-router-structure](../architecture/frontend.md#app-router-structure).

## Alternatives considered

- **A plain SPA (e.g. Vite + React Router) behind the API.** Simpler mental model, but loses
  Server Components (useful for keeping data-fetching logic server-side, see
  [frontend.md#server-vs-client-components](../architecture/frontend.md#server-vs-client-components))
  and built-in SSR, which are relevant given the product may need public-facing pages (QR scan
  landing pages, marketing) alongside the authenticated app.
- **A different meta-framework (Remix, SvelteKit, etc.).** Next.js was already the team's chosen
  stack going into this project (Prompt 00) and has the largest ecosystem/hiring surface for a
  React-based SaaS; no discovered requirement in this architecture phase argues for reopening that
  choice.

## Consequences

- Session-transport for auth (cookie vs. bearer) interacts with Next.js's server/client component
  split — tracked as a `PENDING DECISION` in
  [frontend.md#authentication-and-route-protection](../architecture/frontend.md#authentication-and-route-protection),
  resolved in FASE 4.
- The frontend's authorization checks are UX-only, never the enforcement boundary — the API remains
  authoritative regardless of what Next.js renders or hides, per
  [CLAUDE.md §7.6](../../CLAUDE.md#76-frontend).
