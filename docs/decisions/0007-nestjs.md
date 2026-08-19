# ADR-0007: NestJS for the Backend

## Status

Accepted

## Context

The backend needs a TypeScript framework with strong conventions for the layered, modular
structure described in [backend.md](../architecture/backend.md) — dependency injection, a module
system that can map to bounded contexts, first-class OpenAPI generation, and a mature validation
story — without the team having to invent that structure from a minimal framework like Express.

## Decision

NestJS on Fastify (not Express) — set in the approved stack in Prompt 00. NestJS's `Module` system
is used directly as the bounded-context boundary described in
[modules.md](../architecture/modules.md); its guard/pipe/filter pipeline is used for the tenant
context, permission checks, DTO validation, and centralized error handling described in
[backend.md#cross-cutting-concerns](../architecture/backend.md#cross-cutting-concerns).

## Alternatives considered

- **Express with a hand-rolled structure.** More flexible, but the team would be rebuilding
  dependency injection, a module boundary convention, and OpenAPI generation that NestJS already
  provides — for a modular monolith with many bounded contexts (see
  [ADR-0001](0001-modular-monolith.md)), that structure is exactly what's needed, not incidental
  complexity to avoid.
- **Fastify directly (no Nest layer).** Faster to start, but loses the guard/module/DI conventions
  this architecture leans on heavily for tenant isolation and permission enforcement being
  structural rather than per-route discipline.
- **Express adapter instead of Fastify adapter, within NestJS.** Fastify has materially better raw
  throughput and a first-class NestJS adapter; no requirement identified favors Express
  specifically (e.g. no Express-only middleware dependency exists), so Fastify was kept as set in
  Prompt 00.

## Consequences

- Every module follows the same guard chain (auth → tenant → permission — see
  [api.md#request-flow](../architecture/api.md#request-flow)), which is what makes tenant isolation
  enforcement (see [ADR-0004](0004-tenant-isolation-strategy.md)) consistent across all current and
  future modules rather than re-implemented per module.
- `@nestjs/swagger` decorators are required alongside DTOs for every endpoint, keeping OpenAPI docs
  accurate as a byproduct of implementation rather than separately maintained.
