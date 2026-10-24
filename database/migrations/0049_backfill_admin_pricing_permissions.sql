-- Backfill for tenants provisioned BEFORE the founding "Administrador" template carried these codes
-- (DEFAULT_ROLE_TEMPLATES is only copied into role_permissions at provisioning time): the tenant
-- administrator must be able to raise AND approve a below-minimum price (own request included —
-- PriceApprovalsService lets `pricing.policy.manage` holders resolve their own request).
-- Same exact-role scope as migrations 0032/0044: only the system-default "Administrador" role.
--
-- RLS note (mirrors 0044): roles / role_permissions are FORCE ROW LEVEL SECURITY; FORCE is switched
-- off only for this statement, inside the single transaction Drizzle wraps this file in, and is
-- restored before commit.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM roles r
CROSS JOIN (VALUES ('pricing.policy.manage'), ('pricing.discount.request'), ('pricing.discount.approve'), ('pricing.floor.view')) AS p(code)
WHERE r.name = 'Administrador' AND r.is_system_default = true
ON CONFLICT (role_id, permission_code) DO NOTHING;--> statement-breakpoint

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
