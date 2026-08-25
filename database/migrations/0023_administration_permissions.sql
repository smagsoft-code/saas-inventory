-- New permission catalog rows for FASE 11 (ADMINISTRATION — tenant configuration) —
-- database.md#new-permission-codes's established pattern: catalog content (migration-inserted
-- rows), not a mechanism change — no ADR needed, same precedent as migrations 0014/0015/0016/0017.
-- Gates administration/tenant-settings/* (GET/PATCH /administration/tenant-settings). No permission
-- codes are added for the platform-admin (SuperAdmin) endpoints in this phase — per rule 13/rule 33
-- of this phase's own scope, platform-level operations are authorized structurally (a valid
-- platform_admins principal, checked by TenantGuard's @PlatformOnly() branch), never by the tenant
-- RBAC permission catalog — see multi-tenancy.md#superadmin-vs-tenant.
INSERT INTO permissions (code, module, description) VALUES
	('administration.settings.view', 'administration', 'Ver la configuracion del tenant actual (zona horaria, horario de atencion)'),
	('administration.settings.manage', 'administration', 'Actualizar la configuracion del tenant actual (zona horaria, horario de atencion)')
ON CONFLICT (code) DO NOTHING;
