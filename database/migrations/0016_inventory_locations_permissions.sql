-- New permission catalog rows for Prompt 07 (Warehouses & Locations administration) —
-- roadmap.md's FASE 7, scoped to warehouses/locations CRUD and user_location_assignments only
-- (inventory_balances/inventory_movements/adjustments/transfers remain FASE 8, not touched here).
-- Same module.action naming convention as products.view/products.manage (migration 0015) — catalog
-- content (migration-inserted rows), not a mechanism change, no ADR needed, same precedent as
-- migrations 0001/0014/0015. core.users.locations.manage already exists (migration 0001) and is
-- reused as-is for the user<->location assignment endpoints — no new code needed for that action.
INSERT INTO permissions (code, module, description) VALUES
	('warehouses.view', 'inventory', 'Listar y ver almacenes del tenant actual'),
	('warehouses.manage', 'inventory', 'Crear/actualizar almacenes del tenant actual'),
	('locations.view', 'inventory', 'Listar y ver ubicaciones (jerarquia) del tenant actual'),
	('locations.manage', 'inventory', 'Crear/actualizar ubicaciones del tenant actual')
ON CONFLICT (code) DO NOTHING;
