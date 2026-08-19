# ADR-0014: Demo Tenant Strategy

## Status

Accepted (strategy); reset mechanism/cadence is a documented `PENDING DECISION`.

## Context

Sales/prospect demos need a realistic, populated environment (products, inventory, sample orders)
without ever touching real tenant data, and without the demo environment becoming a special-cased
exception to the isolation guarantees every other tenant relies on.

## Decision

The demo is an ordinary tenant, flagged (e.g. `is_demo = true` on the `tenants` row), subject to
**exactly the same** tenant-isolation mechanisms as any other tenant (see
[multi-tenancy.md](../architecture/multi-tenancy.md)) — no isolation bypass, no shared-with-real-data
shortcut. It is seeded with synthetic data (demo users, products, categories, brands, warehouses,
locations, inventory, movements, customers, sample orders) via the seed scripts described in
[database/seeds/README.md](../../database/seeds/README.md), never real customer data (per
[CLAUDE.md §7.4](../../CLAUDE.md#74-security)).

## Alternatives considered

- **A special "demo mode" flag that relaxes isolation or authorization for easier reset/sharing.**
  Rejected: any code path that treats the demo tenant differently from a real tenant is a code path
  that could regress real tenant isolation if misapplied, and it directly contradicts "the demo
  must be isolated like any other tenant" from the Prompt 01 brief. The demo being "just a tenant"
  is precisely what keeps it safe and keeps the isolation guarantee uniform.
- **A separate, non-multi-tenant demo deployment (its own database/instance).** Rejected: doubles
  infrastructure to maintain for no isolation benefit over "a tenant flagged as demo within the
  normal multi-tenant database," and would let the demo drift from actually exercising the real
  multi-tenant code paths (arguably reducing its value as a pre-launch sanity check of the
  platform itself).

## Consequences

- Demo data is created and reset via the same seed-script mechanism used for any tenant's initial
  data (see [database/seeds/README.md](../../database/seeds/README.md)), not bespoke demo-only
  code.
- **`PENDING DECISION`:** exact reset cadence/mechanism (on-demand via an admin action, scheduled
  nightly reset, reset-on-login) — deferred to FASE 14 (Demo Environment) in the
  [roadmap](../roadmap/roadmap.md), since it depends on how the demo is actually used in sales
  motions, which isn't determined yet.
- Because the demo tenant is a real tenant, it also incidentally serves as a continuous
  integration-adjacent sanity check that seeding and multi-tenant isolation work end to end.
