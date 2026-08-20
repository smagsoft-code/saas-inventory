CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_key" UNIQUE("email"),
	CONSTRAINT "platform_admins_status_check" CHECK ("platform_admins"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug"),
	CONSTRAINT "tenants_status_check" CHECK ("tenants"."status" IN ('active', 'suspended', 'archived'))
);
--> statement-breakpoint

-- No RLS on this trio — they are platform-scoped, not tenant-owned (database.md#data-classification).
-- Access is by role/GRANT instead: app_tenant has no grant at all on tenants/platform_admins (a
-- tenant connection never lists other tenants); app_platform (SuperAdmin-only service methods)
-- gets SELECT/INSERT/UPDATE — no DELETE, since this schema never hard-deletes a tenant
-- (database.md#soft-delete-policy) or a platform admin (status = 'disabled' instead).
GRANT SELECT, INSERT, UPDATE ON tenants TO app_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON platform_admins TO app_platform;
--> statement-breakpoint

-- permissions: a public catalog, readable by every application role, writable only by
-- app_migrator (via migration INSERT, never application code — database.md#rbac-roles-permissions).
GRANT SELECT ON permissions TO app_tenant, app_platform, app_event_processor, app_public_resolver;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_admins
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Initial permission catalog rows — database.md#new-permission-codes-for-prompt-02-a02-b-capabilities-prompt-02-d.
-- Migration-managed data (versioned with code), not tenant/seed data — see
-- database.md#migration-strategy. Idempotent: safe to re-run.
INSERT INTO permissions (code, module, description) VALUES
	('catalog.attributes.manage', 'catalog', 'Crear/editar/desactivar attribute_definitions, attribute_options, category_attributes'),
	('catalog.qr.manage', 'catalog', 'Generar/revocar qr_codes de producto o ubicacion'),
	('pricing.policy.manage', 'pricing', 'Configurar tenant_price_policies (umbral de aprobacion, piso de descuento)'),
	('pricing.floor.view', 'pricing', 'Ver product_variants.min_price'),
	('pricing.cost.view', 'pricing', 'Ver product_variants.cost'),
	('pricing.discount.request', 'pricing', 'Solicitar una excepcion de descuento por debajo de min_price'),
	('pricing.discount.approve', 'pricing', 'Aprobar/rechazar una solicitud de excepcion de descuento'),
	('inventory.transfers.request', 'inventory', 'Crear una transferencia (draft)'),
	('inventory.transfers.approve', 'inventory', 'Aprobar una transferencia (autoriza la reserva de stock)'),
	('inventory.transfers.dispatch', 'inventory', 'Despachar una transferencia (decrementa fisico en origen)'),
	('inventory.transfers.receive', 'inventory', 'Registrar recepcion total o parcial de una transferencia'),
	('inventory.returns.manage', 'inventory', 'Recibir una devolucion e inspeccionar/disponer (restock/quarantine/damaged/scrap)'),
	('import.execute', 'import', 'Ejecutar el pipeline de importacion completo (upload, mapeo, validacion, preview, commit)'),
	('import.inventory', 'import', 'Adicional a import.execute, requerido cuando duplicate_handling_mode = update_catalog_and_inventory'),
	('core.users.locations.manage', 'core', 'Asignar/quitar restricciones de ubicacion a un usuario (user_location_assignments)')
ON CONFLICT (code) DO NOTHING;
