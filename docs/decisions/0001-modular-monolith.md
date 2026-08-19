# ADR-0001: Modular Monolith over Microservices

## Status

Accepted

## Context

The backend needs an architecture that supports a growing set of bounded contexts (tenants,
catalog, inventory, sales, notifications, reports, ...) for a product still finding product-market
fit, built and operated by a small team. It must also not paint the project into a corner if the
platform later grows to thousands of tenants — see [scalability.md](../architecture/scalability.md).

## Decision

Build one deployable NestJS application (a **modular monolith**), internally organized into the
bounded-context modules defined in [modules.md](../architecture/modules.md), each with an enforced
public interface (only a module's exported service is used by other modules; no reaching into
another module's repository or entities directly). This module boundary is designed to double as
the future service boundary if a module is ever extracted — see
[backend.md](../architecture/backend.md#style-modular-monolith).

## Alternatives considered

- **Microservices from the start.** Rejected: at current scale it adds distributed-transaction
  complexity (tenant isolation and inventory consistency currently rely on single-database
  transactions — see [multi-tenancy.md](../architecture/multi-tenancy.md) and
  [modules.md#inventory-flow-conceptual](../architecture/modules.md#inventory-flow-conceptual)),
  network calls where function calls would do, and operational overhead (many deployables, service
  discovery, inter-service auth) that a small team building toward product-market fit does not
  benefit from yet.
- **Unstructured monolith (no module boundaries).** Rejected: without enforced module boundaries,
  a growing codebase accumulates implicit cross-module coupling that makes both reasoning about
  tenant isolation and any future extraction much harder. The bounded-context structure costs
  little now and preserves the option to split later.

## Consequences

- All modules share one database connection pool and one deployment unit — simpler operations, but
  a bug in one module can, in principle, affect the availability of the whole application (mitigated
  by normal engineering discipline — tests, code review — not by process isolation).
- Scaling is initially vertical/replica-based for the whole application, not per-module — see
  [scalability.md](../architecture/scalability.md) for when and how a specific module would be
  extracted once there's a measured reason to.
- Enforcing module boundaries (no cross-module repository access) is a code-review discipline, not
  something the compiler can fully guarantee inside a single NestJS app — this is an accepted
  trade-off of choosing "monolith with discipline" over "network boundary that forces it."
