# ADR-0027: Staged Excel Import Pipeline

## Status

Accepted

## Context

Prompt 02-B requires an in-app, guided bulk-inventory-onboarding flow (dynamic template download,
upload, column mapping, validation, preview, confirm) — never a raw "Excel row → production table"
path, and never a path that bypasses the inventory ledger
([database.md#inventory-warehouses-locations-balance-ledger](../architecture/database.md#inventory-warehouses-locations-balance-ledger))
or writes catalog data without the same validation the interactive product form uses. The design needs
to hold up from a 100-row file to a 100,000-row file without either over-engineering the small case or
under-engineering the large one.

## Decision

Three tables implement a staged pipeline: `import_mapping_templates` (saved, reusable column mappings),
`import_jobs` (one row per import attempt: file, mapping, duplicate-handling mode, status, result
counts), `import_job_rows` (one row per Excel row, staging every row's raw data, mapped data, validation
result, and match resolution — **never** writing to `products`/`product_variants`/`inventory_balances`
directly). Commit happens in transactional batches, reusing the *exact* row-locking convoy
([database.md#concurrency-strategy](../architecture/database.md#concurrency-strategy)) every other
inventory-affecting operation in this schema uses — no separate write path. A new `inventory_movements`
type, `INITIAL_STOCK`, distinguishes digitized starting stock from an operational `RECEIPT`. Full
design: [database.md#excel-import-pipeline](../architecture/database.md#excel-import-pipeline).

**Duplicate-SKU handling recommendation:** default `UPDATE_CATALOG_ONLY` (catalog fields update;
inventory quantity is untouched unless the tenant explicitly opts into
`UPDATE_CATALOG_AND_INVENTORY` for that job) — see the full reasoning and the alternative modes table in
[database.md#committing-transactional-strategy-duplicates-rollback](../architecture/database.md#committing-transactional-strategy-duplicates-rollback).

## Alternatives considered

- **Direct Excel-row-to-production-table writes, validated inline, no staging table.** Rejected outright
  by this prompt's explicit requirement, and independently a bad idea at scale: no resumable/paginated
  preview, no way to show "row 4,102 failed because X" after the fact, and a mid-import failure with no
  staged intermediate state has no clean way to report exactly what did and didn't make it in.
- **One JSONB array on `import_jobs` holding every row, instead of a per-row table.** Rejected for large
  files: no indexed/paginated access to a specific row or status subset without loading the whole
  array, and no natural way to mark individual rows `IMPORTED` incrementally for resumable batch commit.
- **One single database transaction for the entire commit, regardless of file size.** Rejected for large
  files: holding row locks across tens of thousands of rows in one transaction is an operational
  problem in its own right (lock contention, transaction duration, memory). Small imports (below the
  batch-size threshold) *do* get single-transaction, true all-or-nothing semantics — the batching
  trade-off is scale-dependent, not applied uniformly where it isn't needed.
- **Silently updating inventory quantity for a re-uploaded file with an existing SKU (no explicit
  duplicate-handling mode).** Rejected per this prompt's explicit instruction not to decide silently —
  see the recommendation above and its full reasoning in `database.md`: catalog updates and inventory
  quantity changes carry different risk profiles and need separably controllable behavior.
- **Reusing `RECEIPT` for imported starting stock instead of adding `INITIAL_STOCK`.** Rejected: would
  make an operational "how much have we actually received since go-live" report incorrectly include a
  one-time data migration — a real, if modest, reporting-accuracy cost for saving one `CHECK`-list value.

## Consequences

- The import pipeline has no privileged or bypass write path into `inventory_balances`/
  `inventory_movements`/`products`/`product_variants` — every write, however it originates (interactive
  form or a 100,000-row import), goes through the identical validated, locked, ledgered path.
- `import_job_rows` (and, to a lesser degree, `import_jobs`) can accumulate significant volume across
  many large imports over a tenant's lifetime — a retention/cleanup policy for old staging rows is an
  operational sizing decision, not fixed by this ADR (flagged in
  [database.md#open-decisions-carried-forward](../architecture/database.md#open-decisions-carried-forward)).
- File-security controls (extension allow-list excluding macro-enabled formats, content-validated MIME
  type, formula-injection sanitization on the generated error report, object storage) extend the
  existing [security.md#file-upload-security](../architecture/security.md#file-upload-security) rule to
  a new file type rather than inventing a parallel upload-security model.
- Large imports run as a background job, reusing the Event-Processor's established "separate worker,
  not inline in the request path, `FOR UPDATE SKIP LOCKED` claiming" shape
  ([events.md#event-processor](../architecture/events.md#event-processor)) rather than a new async-job
  mechanism.
