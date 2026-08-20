-- New permission catalog rows for Prompt 06 (Catalog/Products administration) —
-- database.md#new-permission-codes-for-prompt-02-a02-b-capabilities-prompt-02-d already names
-- 'products.view' twice as an illustrative example of the module.action naming convention, but no
-- migration ever actually inserted it (or a categories.* counterpart) — found auditing Prompt 06.
-- Catalog content (migration-inserted rows), not a mechanism change — no ADR needed, same precedent
-- as core.* (migration 0014) and the original catalog.*/pricing.*/import.* rows (migration 0001).
INSERT INTO permissions (code, module, description) VALUES
	('products.view', 'catalog', 'Listar y ver productos y variantes del tenant actual (cost/min_price requieren ademas pricing.cost.view/pricing.floor.view)'),
	('products.manage', 'catalog', 'Crear/actualizar productos y variantes, activar/desactivar'),
	('categories.view', 'catalog', 'Listar y ver categorias del tenant actual y su configuracion de atributos (category_attributes)'),
	('categories.manage', 'catalog', 'Crear/actualizar categorias del tenant actual')
ON CONFLICT (code) DO NOTHING;
