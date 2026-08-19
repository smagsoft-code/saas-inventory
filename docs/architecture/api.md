# API Architecture

Related: [ADR-0005](../decisions/0005-rest-api.md). The API is the single contract for the web
app, future mobile apps, and any future integration — see
[system-overview.md](system-overview.md).

## Versioning

**Decision: URL path versioning, `/api/v1/...`.** Chosen over header-based versioning
(`Accept: application/vnd.saas-inventory.v1+json`) because it's visible in logs, browser network
tabs, and OpenAPI docs without extra tooling, and it's what NestJS's built-in URI versioning
supports directly. A breaking change gets `/api/v2` for the affected resource(s); additive,
backward-compatible changes (new optional field, new endpoint) do not bump the version. There is
no committed policy yet for how long `v1` is supported once `v2` exists — `PENDING DECISION`,
revisited when a `v2` is actually needed.

## Request flow

```mermaid
sequenceDiagram
    participant C as Client (Web/Mobile)
    participant FA as Fastify (NestJS)
    participant AG as Auth Guard
    participant TG as Tenant Guard
    participant PG as Permission Guard
    participant Ctrl as Controller (DTO validation)
    participant Svc as Application Service
    participant DB as PostgreSQL

    C->>FA: HTTPS request + Bearer/cookie + Correlation-Id
    FA->>AG: verify token
    AG-->>FA: 401 if invalid/expired
    FA->>TG: resolve tenant context from token claims
    TG-->>FA: 403 if no resolvable tenant (except public/SuperAdmin routes)
    FA->>PG: check required permission for this route
    PG-->>FA: 403 if missing permission
    FA->>Ctrl: validate body/query against DTO
    Ctrl-->>FA: 400 if validation fails
    Ctrl->>Svc: invoke use case with TenantContext
    Svc->>DB: tenant-filtered query/transaction
    DB-->>Svc: result
    Svc-->>Ctrl: result / domain error
    Ctrl-->>C: response (standard envelope) + Correlation-Id echoed
```

Every failure path returns the same [error envelope](#errors); no route bypasses the guard chain
except explicitly public routes (health check, login, the QR public resolver).

## Errors

A single error shape across the whole API, produced by the global exception filter (see
[backend.md](backend.md#cross-cutting-concerns)):

```json
{
  "statusCode": 404,
  "code": "PRODUCT_NOT_FOUND",
  "message": "Product not found.",
  "correlationId": "b3a1...e9f2"
}
```

- `statusCode` — standard HTTP status.
- `code` — a stable, machine-readable string clients can branch on, independent of the (possibly
  localized later) `message`.
- `message` — human-readable, safe to show a user; never a raw exception message, stack trace, or
  SQL error (see [security.md](security.md)).
- `correlationId` — ties the error back to server-side logs for support/debugging.

This shape is already reflected in `packages/types` (`ApiErrorShape`, from Prompt 00).

## Pagination, filtering, sorting, search

- **Pagination:** offset-based (`page`, `pageSize`) is the default for admin-facing list endpoints,
  matching the `PaginatedResult<T>` / `PaginationParams` shapes already defined in
  `packages/types`. High-volume, append-mostly endpoints (e.g. `InventoryMovement` history) may
  need cursor-based pagination instead for stable results under concurrent writes —
  `PENDING DECISION`, resolved per-endpoint when that endpoint is built, not globally now. The
  Prompt 02 schema's indexes on those tables (e.g. `inventory_movements(tenant_id, created_at)`, see
  [database.md#indexes](database.md#indexes)) support either choice without a schema change, so this
  decision is not blocked by the database design.
- **Filtering:** explicit, documented query parameters per endpoint (e.g. `?status=active`), not a
  generic passthrough query-language — every filterable field is deliberately exposed, not
  whatever happens to exist as a column, which also avoids leaking schema shape.
- **Sorting:** an explicit `sort` parameter with an allow-list of sortable fields per endpoint, for
  the same reason.
- **Search:** free-text search (where a resource needs it) is a distinct, documented parameter
  (e.g. `?q=`), with the underlying implementation (simple `ILIKE`, Postgres full-text search,
  something else) decided per-endpoint when that endpoint is designed.

## Idempotency

State-changing endpoints where a client retry could otherwise duplicate an effect (most notably
order creation, once SALES exists — and, per Prompt 02-A, cart-item mutations, inventory-transfer
receiving events, and sales-return creation/disposition) accept an `Idempotency-Key` header. The API
stores the key (scoped by tenant) with the result of the first request that used it; a retried request
with the same key returns the original result instead of repeating the operation. See the
[order flow](modules.md#order-flow-conceptual--sales-not-implemented-yet) in modules.md and the full
persistence design in [database.md#idempotency](database.md#idempotency). A one-time state transition
that only ever legitimately happens once (e.g. a transfer's dispatch) instead uses a *deterministic*
idempotency key derived from the entity itself, not a client-supplied header — see
[database.md#inventory-transfers-and-in-transit-stock](database.md#inventory-transfers-and-in-transit-stock).

## Correlation ID

Every request either carries a `Correlation-Id` header from the client or has one generated by the
API if absent. It is threaded through logs, the error envelope, and outbound calls made while
handling the request (including the event written to the [outbox](events.md)), so a single request
can be traced end to end.

## Rate limiting

Enforced at the API layer (Redis-backed counters, keyed by tenant and/or IP depending on the
route — e.g. login attempts are limited by IP+identifier to blunt brute force, general API usage
is limited per-tenant to protect the platform from a single noisy tenant). Specific limits are a
tuning decision made alongside [security.md](security.md#rate-limiting-and-brute-force-protection),
not fixed here.

## Public endpoints

A small, explicit set of routes don't require the normal auth/tenant guard chain:

- `GET /health` (already scaffolded).
- Login/token-refresh endpoints (they establish the session, so they can't require one).
- The QR public resolver (`GET /q/:code` or similar) — returns only the subset of information
  appropriate for an unauthenticated scan (see [multi-tenancy.md](multi-tenancy.md) and
  [security.md](security.md) for public-vs-private data rules); it does not require a tenant
  session and does not leak which tenant owns the scanned code beyond what's intentionally public.

Every other route requires the full guard chain shown in [Request flow](#request-flow).

## OpenAPI

Already wired up in the Prompt 00 scaffold (`@nestjs/swagger`, served at `/docs`). Every endpoint
gets `@ApiTags`/`@ApiOkResponse`/DTO-derived schemas as it's built, so the OpenAPI document stays
accurate rather than being written by hand separately.
