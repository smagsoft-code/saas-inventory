# Future work — Refund registry (not started)

**Status:** deferred by owner decision. Sales returns stay **product-focused**: a return records the
physical goods and, once resolved, re-enters stock (`RETURN` movement). Nothing monetary is built.

## What exists today (unchanged)

- `POST /sales-returns` → `inspect` → `resolve` / `cancel` (FASE 13, ADR-0021): partial or total, per
  order line, quantity capped by what was sold minus non-cancelled returns, idempotent resolve, audit
  and domain events.
- A resolved return only moves inventory. The order keeps its `confirmed` status; sales-history cards
  (Ventas sin descuento / Descuentos / Ventas netas / Cantidad de pedidos) do **not** subtract returns
  and do not represent cash collected.
- There is no refund amount, refund authorization, refund record or payment execution anywhere in the
  schema or code.

## Proposal to resume (needs the owner's decisions first)

A `sales_refunds` table linked to `sales_returns` (amount, method, status, registered by, reason),
**recording** a refund — it never executes a payment.

Decisions required before implementing:

1. **Amount:** returned quantity × frozen sale price per line, capped at what the order collected
   (recommended) vs. a free, editable amount.
2. **Authorization:** new permission (e.g. `sales.refunds.manage`, Administrador/Supervisor) and
   separation of duties (the return's creator cannot approve its refund).
3. **States:** `registered` → `paid` | `voided`; `paid` is set by a person when the money is handed
   over, never by the system.
4. **Partial refunds:** several partials per return within its total, idempotent to avoid duplicates.
5. **Report cards:** keep "Ventas netas" unchanged and add a separate "Reembolsado" figure later
   (recommended) vs. subtracting paid refunds.
6. **History indicator:** a "Devuelto / Reembolsado" badge on sales-history rows.

## Scope when resumed

Migration + new permission, endpoints with `Idempotency-Key`, audit + domain event, integration tests
against real PostgreSQL, and the history/cards changes chosen above. No payment-gateway integration.
