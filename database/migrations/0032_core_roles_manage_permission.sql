-- New permission catalog row for the ROLES/PERMISSIONS block (custom role CRUD) —
-- database.md#new-permission-codes's established pattern: catalog content (migration-inserted
-- row), not a mechanism change — no ADR needed for the row itself, same precedent as migrations
-- 0014/0015/0016/0017/0023/0026/0027. Follows the `module.action` naming pattern already used by
-- `core.tenant.update`/`core.roles.assign`.
--
-- `core.roles.manage` gates create/update(name+description)/delete of a tenant's own roles and
-- replacing a role's permission set (`PUT /roles/:id/permissions`) — deliberately one flat code,
-- not fragmented per action (same "do not fragment the catalog" precedent ADR-0031 already applied
-- to `core.roles.assign`). Distinct from `core.roles.read` (list/view) and `core.roles.assign`
-- (assign a role to a user) — those already existed since migration 0014.
--
-- The authorization *rule* this code sits inside (a caller can never edit the permission set of a
-- role currently assigned to themselves, regardless of holding this code) is
-- ADR-0034 — see docs/decisions/0034-role-permission-self-escalation-prevention.md.
INSERT INTO permissions (code, module, description) VALUES
	('core.roles.manage', 'core', 'Crear, editar (nombre/descripcion), eliminar roles y reemplazar el conjunto de permisos de un rol del tenant actual')
ON CONFLICT (code) DO NOTHING;

-- Backfill for every tenant provisioned BEFORE this migration: `DEFAULT_ROLE_TEMPLATES`
-- (packages/shared) is only ever copied into `role_permissions` at tenant-provisioning time
-- (database.md#rbac-roles-permissions — "copying it into per-tenant rows... is what lets a tenant
-- customize its role without touching every other tenant's"), never re-applied to an
-- already-provisioned tenant when the template changes. Every prior permission-catalog migration
-- (0014-0027) left this to a tenant's Administrador to grant manually — which was fine when no
-- role-management UI existed. `core.roles.manage` is different: it is the one permission that
-- gates the UI/endpoints needed to grant *any* permission to a role, itself included — without
-- this backfill, an already-provisioned tenant would have nobody able to reach
-- `PUT /roles/:id/permissions` to grant it, a real bootstrapping deadlock, not merely "self-serve
-- later." Scoped narrowly to the exact template-copied role (`name = 'Administrador'`,
-- `is_system_default = true`) — the same fixed name `ADMIN_ROLE_NAME` in
-- apps/api/src/auth/services/tenant-provisioning.service.ts already relies on — never a
-- tenant-renamed or custom role, so this never grants anything a tenant didn't already intend by
-- keeping its founding role's default name and system-default flag.
INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT tenant_id, id, 'core.roles.manage'
FROM roles
WHERE name = 'Administrador' AND is_system_default = true
ON CONFLICT (role_id, permission_code) DO NOTHING;
