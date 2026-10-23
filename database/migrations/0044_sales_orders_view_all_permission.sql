-- New permission catalog row: who may see the sales of OTHER sellers.
--
-- Until now `sales.orders.view` was the only gate on the sales history, so every seller saw every
-- order of the tenant. From this migration on, `sales.orders.view` means "see MY OWN sales"
-- (orders.placed_by_user_id = me) and `sales.orders.view_all` is the extra permission needed to
-- see the sales of every seller — the order list, the order detail/notifications and the sales
-- report aggregates (including the Home sales cards). Catalog content (migration-inserted row), not a
-- mechanism change — no ADR, same precedent as migrations 0014/0015/0016/0017/0023/0026/0027/0032.
-- `module.resource.action` naming, like `sales.orders.view`.
INSERT INTO permissions (code, module, description) VALUES
	('sales.orders.view_all', 'sales', 'Ver las ventas de todos los vendedores del tenant (sin este permiso solo se ven las ventas propias)')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

-- Backfill for tenants provisioned BEFORE this migration (DEFAULT_ROLE_TEMPLATES is only copied into
-- role_permissions at provisioning time). Only the founding, system-default "Administrador" role —
-- the same exact-role scope migration 0032 used — gets it; Supervisor/Vendedor roles do not, and a
-- tenant can grant it to any role from the role editor.
--
-- RLS note (mirrors 0035/0041/0042/0043): roles and role_permissions have ENABLE + FORCE ROW LEVEL
-- SECURITY and app_migrator's table ownership does not bypass FORCE, so without toggling it the
-- SELECT/INSERT would match zero rows. FORCE is switched off only for this statement, inside the
-- single transaction Drizzle wraps this file in, and is unconditionally restored before commit.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT tenant_id, id, 'sales.orders.view_all'
FROM roles
WHERE name = 'Administrador' AND is_system_default = true
ON CONFLICT (role_id, permission_code) DO NOTHING;--> statement-breakpoint

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
