# ADR-0023: Document Type Selection (Invoice / Sales Note) and the External-Invoicing Boundary

## Status

Accepted

## Context

Prompt 02-A requires that checkout let the customer choose between an invoice (`factura`) and a sales
note (`nota de venta`), that the choice be preserved on the order, and — critically — that the platform
**never issues the invoice itself**: fiscal/electronic invoicing is an external process. The design
needs to record both "what the customer asked for" and, when that's an invoice, "what happened with the
external invoicing process," without conflating the two or implying an integration this prompt
explicitly rules out.

## Decision

Two columns on `orders`, deliberately not one: `document_type` (`'INVOICE' | 'SALES_NOTE'`, what was
requested at checkout — a closed two-value choice, not a boolean) and `invoice_status`
(`'PENDING' | 'ISSUED' | 'FAILED'`, nullable, meaningful only when `document_type = 'INVOICE'`,
enforced by a `CHECK`). The platform's own responsibility stops at recording the request and, later,
recording whatever an external process reports back (`ISSUED`/`FAILED`) — it never generates a fiscal
document, never talks to a tax authority or invoicing provider, and no such integration is designed or
implied. Full schema:
[database.md#orders-conceptual--sales-not-built-yet](../architecture/database.md#orders-conceptual--sales-not-built-yet).

## Alternatives considered

- **A single boolean `is_invoice`.** Rejected per this prompt's explicit instruction: a boolean can't
  grow a third document type later (a credit note, a proforma) without a breaking schema change, and
  reads less clearly at every call site than an explicit, named two-value choice — the same reasoning
  already applied to every other status/type column in this schema (the `text` + `CHECK IN (...)`
  convention, [database.md#conventions](../architecture/database.md#conventions)).
- **Conflating `document_type` and `invoice_status` into one column** (e.g. `'sales_note' |
  'invoice_pending' | 'invoice_issued' | 'invoice_failed'`). Rejected: this prompt explicitly
  distinguishes "what was requested" from "what happened with the external process," and a
  `SALES_NOTE` order simply has no invoicing status at all — collapsing them into one column would
  either need a meaningless value for that case or lose the distinction the prompt asks to keep.
- **Designing an actual fiscal-provider integration now** (API client, provider credentials, retry
  logic). Explicitly rejected — this prompt's architectural rule is that invoicing is external, and
  building an integration would both violate that rule and get ahead of a provider choice that hasn't
  been made. `invoice_status` exists so the *outcome* of whatever external process exists can be
  recorded, not so the platform can drive that process.

## Consequences

- Any endpoint/notification that needs to tell a supervisor "this needs to be invoiced externally"
  reads `document_type = 'INVOICE' AND invoice_status = 'PENDING'` directly off the order — no
  derived state, no separate table needed for that signal.
- If a real invoicing integration is ever built, `invoice_status` already has the right shape to be
  updated by it (`PENDING → ISSUED`/`FAILED`) — this ADR doesn't need to be revisited for that, only
  extended with whatever integration-specific fields (a provider invoice id/number) turn out to be
  needed at that time.
- `SALES_NOTE` orders carry a `NULL` `invoice_status` by construction (the `CHECK` constraint), not a
  default `'PENDING'` that would misleadingly suggest an invoicing process exists for them.
