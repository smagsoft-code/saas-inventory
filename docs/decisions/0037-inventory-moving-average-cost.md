# ADR-0037: Inventory Costing — Weighted-Average, Computed Never Stored

## Status

Accepted

## Context

`docs/architecture/reporting/data-gaps.md` (`GAP-COST`) documented that `inventory_movements` carried
no cost/value column at all, that `product_variants.cost` is a single current, nullable, mutable spot
value with no history (unlike `price`, which has `product_price_history`), and that the existing
inventory-summary report's `totalCostValue` was an explicitly-labeled stopgap ("current cost ×
current quantity", never FIFO/weighted-average). That document called for its own ADR "before any
[costing] phase" — this is that ADR, triggered by UI-UX-SPEC-001's Kardex, which requires a real
Costo U / Costo K (weighted-average) / Stock S per row.

`inventory_movements` (`05-inventory.ts`) is the append-only source of truth for stock; every write
goes through `StockLedgerService.applyMovement`, the single locking convoy used by sales, returns,
transfers, adjustments, and the Excel import pipeline.

## Decision

**Store the fact, derive the average.** A nullable `unit_cost` column was added to
`inventory_movements` (migration `0034`), but it is populated only where a cost is a genuine
transactional fact:

- `RECEIPT` ("Agregar stock") — mandatory, user-supplied (`CreateAdjustmentDto.unitCost`, enforced
  by validation, never defaulted).
- `ADJUSTMENT_IN` — optional; defaults to the current moving average when omitted (a found-inventory
  correction is assumed not to move the average).
- `RETURN` — copied from the original sale's `order_items.unit_cost_snapshot` (already a frozen,
  real historical fact), for symmetry with the outflow it reverses.
- `INITIAL_STOCK` / import-driven `ADJUSTMENT_IN` — the import row's own declared `cost`.
- `TRANSFER_OUT` — the moving average at the source right before dispatch, stored purely as the
  carrier value its paired `TRANSFER_IN` copies (a destination has no way to derive "what this batch
  cost" from its own, unrelated ledger history).

`SALE` and manual `ADJUSTMENT_OUT` **never** store a cost. An outflow's Costo U is, by the textbook
weighted-average rule, the average vigente immediately before it — always derived at read time by
folding the ordered ledger (`apps/api/src/inventory/kardex/kardex-costing.ts`), never stored. The same
pure fold function seeds a date-ranged Kardex's opening balance (fold everything before `from`) and
answers the write-side's "what's the current average" question (`MovingAverageCostService`, used only
by `ADJUSTMENT_IN`'s default and `TRANSFER_OUT`'s dispatch-time snapshot).

A legacy row predating this column, or a variant with no cost configured anywhere, falls back to the
variant's current `cost` and is flagged `estimated: true` in every API response that surfaces it —
never silently blended in as fact.

`unitCost`/`averageCost`/`stockValue` fields are field-gated on `pricing.cost.view` (ADR-0028's
existing precedent), on `GET /inventory/movements`, `POST /inventory/adjustments`, and the new
`GET /reports/kardex` — a caller with only `inventory.view` still gets quantities and labels.

## Alternatives considered

- **Store a running average-cost column on `inventory_balances`, updated on every movement.**
  Rejected: duplicates state the ledger can always recompute, and a bug in the update path would leave
  a silently-wrong average with no way to detect or repair it short of replaying history anyway —
  since replay is unavoidable as a correctness backstop, it might as well be the only source of truth.
- **Recompute and store a Costo K value per movement row at write time.** Rejected for the same
  reason: a value computed once and frozen cannot self-correct if an earlier movement is ever found to
  be wrong, and nothing in this ledger is ever corrected by mutating a past row (it is append-only) —
  a backdated movement must retroactively change every average after it, which only a read-time fold
  can do for free.
- **FIFO/lot-level costing.** Rejected as out of scope: the schema has no lot-cost table, and
  UI-UX-SPEC-001 explicitly asked for weighted-average (worked numeric examples in its own §37 match
  the weighted-average recurrence, not FIFO layers).
- **Defer all costing and ship the Kardex with quantities only.** Considered and offered to the
  product owner as an option; rejected by the owner in favor of full costing now, since the
  ledger/date/product parts of the Kardex would otherwise ship without the Costo U/Costo K/Stock S
  columns the spec's own worked test cases require.

## Consequences

- Every write path that can insert a physical-bucket movement (`orders.service.ts`,
  `returns.service.ts`, `transfers.service.ts`, `movements.service.ts`,
  `import-execution.service.ts`) now carries an explicit, documented decision about whether and how it
  populates `unit_cost` — see `kardex-costing.ts`'s header comment for the full map.
  `StockLedgerService.applyMovement` itself stays mechanical: it persists whatever `unitCost` its
  caller passes, never computes one.
- A transfer's destination cost is exact (copied from the exact dispatch), not re-derived from an
  average that may have moved at the source since — correct for "what did these specific units cost",
  which is what moved physically.
- Historical accuracy is bounded by data that existed when this ADR shipped: stock that predates
  migration `0034` has no per-movement cost and is priced from the variant's current cost, flagged
  `estimated`. This taint is not tracked at lot granularity — once an estimated-cost lot blends into a
  weighted average, subsequent rows drawing on that average stay flagged `estimated` until the
  variant+location's own history no longer contains any inbound row with a missing cost, which a
  weighted average (unlike FIFO) cannot precisely determine lot-by-lot. This is a known, accepted
  simplification, not a bug.
- `GET /reports/kardex` cannot answer "what's the Kardex across all this variant's locations" as a
  single blended view — cost is only well-defined per (variant, location) pair, so the API requires
  both ids. A future "purchase by invoice" feature (explicitly out of scope here) plugs into the same
  `RECEIPT`-shaped seam: a mandatory cost, populated the same way `unit_cost` already is.
