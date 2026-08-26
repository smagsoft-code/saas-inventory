-- New permission catalog rows for FASE 13 (SALES — sales returns lifecycle) —
-- database.md#new-permission-codes's established pattern: catalog content (migration-inserted
-- rows), not a mechanism change — no ADR needed, same precedent as migrations
-- 0014/0015/0016/0017/0023/0026. Follows the `module.resource.action` naming pattern already used
-- by `sales.orders.create`, `inventory.transfers.request`.
--
-- Only the two SALES-owned "administrative" return actions are new here:
--   * sales.returns.view   — list/read a tenant's sales returns
--   * sales.returns.create — file a return request against a confirmed order, and cancel it
-- The stock-affecting half of the return lifecycle (inspect + resolve — set disposition and write
-- the RETURN inventory movement) reuses `inventory.returns.manage`, which has existed since
-- migration 0001 and whose catalog description already reads
-- "Recibir una devolucion e inspeccionar/disponer (restock/quarantine/damaged/scrap)" — it is not
-- re-created here. The exceptional-pricing half of FASE 13 (price_approvals request/approve/reject)
-- reuses `pricing.discount.request` / `pricing.discount.approve`, also from migration 0001 — no new
-- pricing codes.
--
-- No new GRANTs: sales_returns / sales_return_items / price_approvals already carry their full
-- app_tenant GRANT set from migration 0009, tenant_price_policies from migration 0003, and
-- idempotency_keys from migration 0011 — FASE 13 is purely the application layer on top of a schema
-- that has existed since Prompt 03.
INSERT INTO permissions (code, module, description) VALUES
	('sales.returns.view', 'sales', 'Listar y ver las devoluciones de venta del tenant actual'),
	('sales.returns.create', 'sales', 'Crear y cancelar una solicitud de devolucion de venta (contra una orden confirmada)')
ON CONFLICT (code) DO NOTHING;
