# ADR-0040: Seller Scope for Order-Derived Operations and Reads

## Status

Accepted (2026-10-26)

## Context

`sales.orders.view_all` (migration `0044`) made order **reads** seller-scoped: a seller without it sees only the orders they
placed (a hidden order is a `404`). The HTTP tenant-isolation sweep of 2026-10-26 showed that this rule had not been carried to the
operations and documents that hang off an order:

- order `confirm` / `cancel` (a seller got `404` reading another seller's order yet `200` confirming or cancelling it);
- `POST /price-approvals` (and its optional `newPrice`, which can rewrite the line price);
- `POST /sales-returns` and its `cancel`;
- the **reads** of price-approval requests and sales returns (lists, lookups by id, and the returns-summary aggregate), which were
  scoped by location only.

Tenant isolation held throughout; these were intra-tenant gaps. See `docs/security/tenant-isolation-http-matrix.md`.

## Decision

One rule, implemented once (`apps/api/src/sales/orders/order-seller-scope.ts`): **an operation that names an existing order, or a
document derived from one, is subject to the same seller scope as reading the order.** A seller without `sales.orders.view_all`
acts on, and reads, only what belongs to orders **they placed**; anything else answers exactly like a missing resource (`404`, or
absent from the list and its totals), and the scope is applied before any status-dependent answer so existence and state cannot be
inferred.

1. **Writes** — order confirm/cancel, price-approval request (including `newPrice`), sales-return creation and cancellation. The
   functional permission (`sales.orders.create`, `sales.orders.cancel`, `pricing.discount.request`, `sales.returns.create`) is
   **still required separately**: `view_all` widens the scope, it never grants an action. The idempotency record of a return belongs
   to its actor (the request hash includes the actor), so another user replaying a key gets a conflict, never the stored return.
2. **Reads of price-approval requests** — a requester sees the requests on their own orders. **Approvers**
   (`pricing.discount.approve`) keep the whole queue — it is their work queue — and `view_all` widens it. List, totals and
   lookup by id use the same predicate.
3. **Reads of sales returns** — a seller sees the returns of their own orders. The **warehouse** (`inventory.returns.manage`, the
   holders of inspect/resolve) keeps every return, bounded by the location scope (ADR-0024/0035), and `view_all` widens it. The
   `returns-summary` report carries the same predicate, so an aggregate never reveals what the list hides.
4. **Not seller-scoped, by design** — `approve` / `reject` (approvers) and `inspect` / `resolve` (warehouse) act across sellers; they
   are gated by their functional permission (and, for the warehouse, the location scope), and a seller, `view_all` alone or
   another tenant cannot call them.
5. **Inventory ledger references** (amendment, FASE 19, 2026-10-26) — the movement list (`GET /inventory/movements`) and the Kardex
   (`GET /reports/kardex` and its xlsx / pdf export) label order and return movements with their document number, the order uuid
   (`referenceId`) and the actor. They are `inventory.view` reads, a permission sellers hold, so they follow the same scope:
   the reference of an order movement (`SALE`, reservation, commitment) is shown to the seller who placed the order and to
   `sales.orders.view_all`; the reference of a return movement additionally to the warehouse (`inventory.returns.manage`). Anyone
   else still sees the **row and the stock arithmetic** (type, quantity, balance, cost rules unchanged) — stock is tenant-wide
   inventory truth — but with a generic label (`Venta` / `Pedido` / `Devolución`) and without number, uuid, free-text reason or actor.
   Transfers and imports are not seller documents and are unchanged. The scope is applied where the reference is resolved, so the
   export inherits it.
6. **No new permission** is introduced: the rule reuses `sales.orders.view_all`, `pricing.discount.approve` and
   `inventory.returns.manage`.

## Consequences

- A seller's approvals and returns screens show their own documents only. Approvers and the warehouse are unchanged.
- The default **Supervisor** (holds `pricing.discount.approve` and `inventory.returns.manage`, not `view_all`) keeps the approvals
  queue and every return, and can approve, reject, inspect and resolve — but can no longer **create or cancel** a return, or confirm/cancel an
  order, for a seller's order unless granted `sales.orders.view_all` (it never held `pricing.discount.request`, so it never filed
  approval requests). A tenant that wants that grants
  the permission to the role.
- Tests that created documents with one user and read or acted on them with another had to state who owns the order; the intent of
  each was kept.
- The default **Supervisor** and **Bodega** (no `view_all`) no longer see order numbers in the ledger (`Venta #…`); they still see
  every return number. A tenant that wants them to see order numbers grants `sales.orders.view_all`.
- Reference types other than `order` / `sales_return_item` (transfers, imports, manual adjustments and receipts) are untouched.

## Alternatives considered

- **New permissions** (`pricing.discount.view`, `sales.returns.view_all`): rejected — the existing permissions already express the
  three audiences (seller, approver, warehouse) and a new code needs a migration and role-template changes for no extra distinction.
- **Location scope only** (status quo): rejected — it let any seller read or act on a colleague's negotiation and returns at the
  same location.
- **Scope the approver / warehouse routes by seller too:** rejected — it would stop approvers and warehouse staff from doing their
  work.
