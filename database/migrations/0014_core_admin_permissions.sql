-- New permission catalog rows for Prompt 05-A (tenant/user/role administration) —
-- database.md#new-permission-codes-for-prompt-02-a02-b-capabilities-prompt-02-d's established
-- pattern: catalog content (migration-inserted rows), not a mechanism change — no ADR needed, same
-- as the existing core.users.locations.manage precedent. Migration-managed data, idempotent.
INSERT INTO permissions (code, module, description) VALUES
	('core.tenant.update', 'core', 'Actualizar los datos editables del tenant actual (nombre)'),
	('core.users.read', 'core', 'Listar y ver el detalle de los usuarios del tenant actual'),
	('core.users.create', 'core', 'Crear un nuevo usuario dentro del tenant actual'),
	('core.users.update', 'core', 'Actualizar el perfil o estado (invited/active/disabled) de un usuario del tenant actual'),
	('core.roles.read', 'core', 'Listar los roles del tenant actual y sus permisos'),
	('core.roles.assign', 'core', 'Asignar o cambiar el rol de un usuario del tenant actual')
ON CONFLICT (code) DO NOTHING;
