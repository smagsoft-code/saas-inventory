-- New permission catalog rows for Prompt 08 (Inventory balances/movements/adjustments) —
-- roadmap.md's FASE 8. database.md (lines 579, 646) already used 'inventory.adjust' as the
-- illustrative example of the module.action naming convention, but no migration ever actually
-- inserted it, and no generic read permission for inventory_balances/inventory_movements exists
-- either — same gap-filling precedent as migrations 0015 (products.*/categories.*) and 0016
-- (warehouses.*/locations.*). inventory.transfers.request/approve/dispatch/receive and
-- inventory.returns.manage already exist since migration 0001 and are reused as-is for FASE 8's
-- transfer endpoints — no new codes needed for transfers.
INSERT INTO permissions (code, module, description) VALUES
	('inventory.view', 'inventory', 'Listar y ver inventory_balances e inventory_movements (ledger) del tenant actual'),
	('inventory.adjust', 'inventory', 'Crear un ajuste manual de inventario (RECEIPT/ADJUSTMENT_IN/ADJUSTMENT_OUT), sujeto a autorizacion por ubicacion (ADR-0024)')
ON CONFLICT (code) DO NOTHING;
