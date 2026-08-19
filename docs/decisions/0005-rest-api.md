# ADR-0005: REST API (not GraphQL)

## Status

Accepted

## Context

The API must serve the Next.js web app, future Android/iOS apps, and possible future third-party
integrations, as the single path to PostgreSQL (see
[system-overview.md](../architecture/system-overview.md)). It needs to be well-understood by any
client platform, cache-friendly, and straightforward to document, secure, and rate-limit.

## Decision

REST, versioned at `/api/v1`, documented via OpenAPI (`@nestjs/swagger`, already scaffolded). Full
conventions in [api.md](../architecture/api.md).

## Alternatives considered

- **GraphQL.** Attractive for flexible client-driven queries, but adds real cost here: per-field
  authorization is harder to reason about uniformly with the permission-guard model in
  [security.md#authorization-rbac--permissions](../architecture/security.md#authorization-rbac--permissions),
  rate-limiting/caching is less straightforward than REST's per-endpoint model, and it is a second
  paradigm the team and any future mobile developers need to learn on top of NestJS's REST-first
  ergonomics. Nothing about the current requirements (mobile clients, integrations) specifically
  needs GraphQL's flexible querying.
- **gRPC.** Excellent for service-to-service calls, poor fit for browser clients and for the kind
  of ad hoc third-party integration this platform anticipates later; would also require a
  translation layer for the web app regardless.

## Consequences

- Every new endpoint follows the shared conventions (versioning, error envelope, pagination,
  correlation ID — see [api.md](../architecture/api.md)) rather than each module inventing its own
  shape.
- OpenAPI documentation is a byproduct of building the endpoint correctly (decorators already
  required for validation), not separate documentation work.
- If a future need genuinely requires flexible client-driven queries (e.g. a complex reporting UI),
  that can be revisited for that specific surface without changing the rest of the API — this ADR
  is a default, not a permanent constraint on every future endpoint.
