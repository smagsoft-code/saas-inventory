-- New permission catalog rows for FASE 12 (SALES — customers, carts, orders) —
-- database.md#new-permission-codes's established pattern: catalog content (migration-inserted
-- rows), not a mechanism change — no ADR needed, same precedent as migrations
-- 0014/0015/0016/0017/0023. Follows the `module.resource.action` naming pattern already used by
-- `inventory.transfers.request`, `core.users.locations.manage`, `administration.settings.view`.
--
-- Grouped deliberately, not fragmented per capability (database.md#new-permission-codes): one
-- `sales.carts.manage` covers the whole mutable cart surface (create, add/change/remove items),
-- since one vendor drives it end to end; `sales.orders.create` covers both checkout (POST /orders)
-- and confirmation (POST /orders/:id/confirm), the same "one authorized user drives the flow"
-- grouping `import.execute` already uses for the multi-step import pipeline.
--
-- No new GRANTs: customers/carts/cart_items/orders/order_items already carry their full app_tenant
-- GRANT set from migration 0009, and idempotency_keys from migration 0011 — FASE 12 is purely the
-- application layer on top of a schema that has existed since Prompt 03.
--
-- Pricing is NOT re-fragmented here: `pricing.floor.view` (see min_price) and
-- `pricing.discount.request` (below-min exception, FASE 13) already exist since migration 0001 and
-- are reused as-is.
INSERT INTO permissions (code, module, description) VALUES
	('sales.customers.view', 'sales', 'Listar y ver los clientes del tenant actual'),
	('sales.customers.manage', 'sales', 'Crear y actualizar clientes del tenant actual'),
	('sales.carts.manage', 'sales', 'Operar el carrito de venta (crear, agregar/cambiar/quitar items, negociar precio)'),
	('sales.orders.view', 'sales', 'Listar y ver las ordenes de venta del tenant actual'),
	('sales.orders.create', 'sales', 'Crear (checkout) y confirmar una orden de venta; reserva y compromete inventario'),
	('sales.orders.cancel', 'sales', 'Cancelar una orden de venta antes de la confirmacion (libera la reserva de inventario)')
ON CONFLICT (code) DO NOTHING;
