# ADR-0022: Three-Tier Pricing, Price History, and Exceptional-Discount Approval

## Status

Accepted

## Context

Prompt 02's `product_variants` had a single `price` column. Prompt 02-A requires a vendor to be able to
negotiate within an authorized range (a maximum/reference price shown on the QR, a base suggested
price, and a minimum floor), requires anything below that floor to go through an explicit approval
workflow, requires the range to be tenant-configurable rather than platform-fixed, requires every
historical sale to preserve exactly what was authorized and by whom, and requires that an old QR code
never create ambiguity about what the reference price was at some point in the past. This is a genuine
revision of a Prompt 02 column, not an extension alongside it — recorded as
[discrepancy #5](../architecture/database.md#discrepancies-found-and-how-they-were-resolved) rather
than silently overwritten.

## Decision

Three separate mechanisms for three separate concerns:

1. **Values, current + historical** — `product_variants.max_price`/`base_price`/`min_price` replace
   the single `price` column (current values, read on every hot path with no join) and
   `product_price_history` (append-only, `effective_from`/`effective_to`) records every change —
   mirroring the balance/ledger split already used for inventory. A dispute over "what did the QR say
   on that date" is answered by querying history, not by anything stored on the QR row itself (which
   never stores a price at all — see [database.md#qr-codes](../architecture/database.md#qr-codes)).
2. **Governance, per tenant** — `tenant_price_policies` (one row per tenant):
   `exceptional_discount_requires_approval` and `max_discount_below_min_percent` (a hard floor beyond
   which even an approval request is rejected outright). Tenant-configurable per this prompt's
   explicit instruction not to assume identical commercial rules across tenants.
3. **Workflow** — `price_approvals`, linked to the specific `order_item_id` requesting an exception,
   `pending`/`approved`/`rejected`/`cancelled` (lowercase, per the enum-value naming convention closed
   in Prompt 02-D — see [database.md#conventions](../architecture/database.md#conventions)), with a
   partial unique index (`UNIQUE (tenant_id, order_item_id) WHERE status = 'pending'`) preventing a
   duplicate open request for the same line by construction. Order confirmation is gated on no
   `pending` approvals remaining.

Full schema:
[database.md#pricing-history-tenant-policy-and-exceptional-discount-approval](../architecture/database.md#pricing-history-tenant-policy-and-exceptional-discount-approval).

## Alternatives considered

- **A single `price` column plus an ad hoc `discount_percent` cap enforced only in application code.**
  Rejected: doesn't distinguish "normal negotiation within an authorized range" from "exceptional,
  needs sign-off" as two structurally different things — the whole approval workflow this prompt
  requires depends on that distinction being real, not inferred from a percentage threshold checked
  inconsistently across code paths.
- **A generic rule-engine / policy table supporting arbitrary per-category, per-role, or per-customer
  pricing rules.** Rejected as premature: nothing in this prompt's requirements asks for that
  granularity — `tenant_price_policies` as one row per tenant is a handful of fixed columns for a fixed
  rule shape (within range / below min / below a hard floor). A richer model is deferred, flagged in
  [database.md#open-decisions-carried-forward](../architecture/database.md#open-decisions-carried-forward),
  not built ahead of a concrete need.
- **Storing a price/version directly on `qr_codes`.** Rejected: would need active maintenance
  (updating the QR row every time the price changes) for no benefit over simply always resolving to
  the *current* `max_price` at scan time — nothing on the QR would ever need to be "the wrong version"
  if it never stores a version at all. History for dispute purposes lives in `product_price_history`
  instead, entirely decoupled from the QR mechanism.
- **A single `negotiated_price` column on `order_items`, separate from `unit_price_snapshot`.**
  Rejected as redundant per this prompt's own instruction to avoid duplicating fields —
  `unit_price_snapshot` already means "the final price actually charged," which is exactly what
  "negotiated price" means once a sale is made.

## Consequences

- Every `product_variants` row now needs all three price columns filled in (not just one), with
  `CHECK (min_price <= base_price <= max_price)` enforced at insert/update — a data-entry change for
  Prompt 03's product-creation flow, not just a schema change.
- `order_items` carries three additional snapshot columns (`max_price_snapshot`, `base_price_snapshot`,
  `min_price_snapshot`) alongside the existing `unit_price_snapshot`, plus `is_exceptional_discount` —
  slightly wider rows, in exchange for every historical sale being fully self-describing for audit
  without joining back to (possibly since-changed) product or approval data.
- The cross-table check ("is this request below the tenant's hard floor") is application logic, not a
  database `CHECK` — a `CHECK` constraint cannot reference another table without a trigger, and this is
  a business-rule guard, not a tenant-isolation-critical invariant that would justify one.

## Amendment (2026-10-05): exceptional-discount trigger moved from `min_price` to `base_price`

Owner policy change. The original decision (above) treated `[min_price, max_price]` as one
undifferentiated "normal negotiation" band and reserved the `price_approvals` workflow for anything
below `min_price`. The owner now requires any price **below `base_price`** to go through the same
approval workflow — `base_price` is no longer just a suggested starting point, it is the real
exceptional-discount trigger. `min_price` keeps exactly its prior, narrower role: the tenant's hard
floor (`max_discount_below_min_percent`), below which no approval can authorize a sale at all. A price
in `[min_price, base_price)` is now exceptional but never subject to the hard-floor rejection — only a
price actually below `min_price` is.

Mechanically: `SalesPricingService.classify()`'s `below_min` result was renamed `below_base` and its
comparison changed from `unitPrice < minPrice` to `unitPrice < basePrice`; `assertWithinHardFloor` is
unchanged (still keyed to `minPrice`). `price_approvals` gained a `base_price_at_request` column
(migration `0038`, backfilled from each request's `order_items.base_price_snapshot`) so an approver
can see what threshold actually triggered a given request — `minPriceAtRequest` alone no longer
explains it, since a request can now exist for a price still above `min_price`.

No schema change to `product_variants`/`tenant_price_policies` — `base_price` already existed as a
live value read on every hot path; only its *role* changed. Existing `pending` orders created before
this change keep whatever `is_exceptional_discount` value they were frozen with (no backfill on
`order_items` — frozen history is never rewritten, per this ADR's own §1).
