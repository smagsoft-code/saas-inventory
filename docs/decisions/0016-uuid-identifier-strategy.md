# ADR-0016: UUIDv7 Primary Keys, Generated in the Application

## Status

Accepted

## Context

The Prompt 01 architecture already committed to UUID primary keys over auto-increment integers
(sequential IDs leak row counts/growth rate cross-tenant and are trivially enumerable), but left the
exact generation strategy — random UUIDv4 vs. time-ordered UUIDv7, and where the value is generated —
as a `PENDING DECISION` for Prompt 02 (see the Prompt 01 version of
[database.md](../architecture/database.md)).

## Decision

Every primary key is a UUIDv7, generated in application code (a shared `generateId()` helper, added
to `packages/shared` in Prompt 03) at the moment a new row's identity is needed — not by a PostgreSQL
`DEFAULT`. Full detail: [database.md#identifiers-uuidv7](../architecture/database.md#identifiers-uuidv7).

Two reasons, both material to this platform's actual write pattern:

1. **Index locality.** UUIDv7 embeds a millisecond timestamp in its high bits, so values generated
   close in time sort close together. On this schema's highest-write-volume tables
   (`inventory_movements`, `audit_log`, `event_outbox`, `orders`), that means new rows append at the
   right edge of the PK's B-tree index instead of scattering across random pages — materially less
   index/page fragmentation and better buffer-cache behavior than UUIDv4's fully-random values under
   sustained insert load.
2. **Id known before insert.** Generating the id in application code means it exists before the
   `INSERT` runs, so a single request can reference the same id across multiple statements/tables in
   one transaction (e.g. an `inventory_movements` row and its `event_outbox` row correlating without
   a round-trip to read back a DB-generated value), and the API can return the created resource's id
   synchronously.

## Alternatives considered

- **UUIDv4, `DEFAULT gen_random_uuid()`.** Simpler (no new library, generation is free via
  `pgcrypto`), but gives up index locality on exactly the tables where write volume matters most, and
  doesn't solve the "id known before insert" need — a second reason this was rejected even before the
  index-locality argument.
- **Native PostgreSQL UUIDv7 generation.** Not reliably available across the PostgreSQL versions this
  platform targets; application-side generation via an established library is portable regardless of
  server version.
- **Auto-increment integers with a separate, non-sequential public identifier column.** Would need
  every table to carry two identifiers (internal PK, public-facing opaque id) and every join/FK to
  consistently pick the right one — more surface area for a tenant-isolation-relevant mistake than a
  single UUID column, for no benefit this platform needs.

## Consequences

- PK/FK columns are Postgres native `uuid` (16 bytes, fixed-width comparison/indexing), never
  `text`/`varchar` — this is also what keeps the composite tenant-aware FK pattern
  ([ADR-0018](0018-tenant-aware-referential-integrity.md)) cheap to index.
- Every table still gets `DEFAULT gen_random_uuid()` as a fallback (requires `pgcrypto`) purely so a
  manual/administrative `INSERT` that forgets to supply an id doesn't hit a `NOT NULL` violation —
  not the primary generation path, and its v4-ness there is an accepted trade-off since it's not the
  write-heavy path this decision optimizes for.
- Prompt 03 adds a UUIDv7 library dependency and a `generateId()` export in `packages/shared`, used by
  every repository at row-creation time.
