/**
 * Framework-agnostic utility functions shared between apps.
 * Business logic does not belong here — only generic, reusable helpers.
 */
import { uuidv7 } from 'uuidv7';

/**
 * Generates a UUIDv7 primary key, in application code, never via a PostgreSQL DEFAULT.
 * See ADR-0016 (docs/decisions/0016-uuid-identifier-strategy.md) — time-ordered ids keep
 * high-write-volume table indexes append-mostly, and the id is known before INSERT so a
 * single transaction can correlate it across multiple tables (e.g. a movement + its outbox event).
 */
export function generateId(): string {
  return uuidv7();
}

export function isNonNullable<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The fixed, application-level role template copied into a newly-created tenant's
 * roles/role_permissions at provisioning time — database.md#rbac-roles-permissions: "The template
 * itself lives in application code (or a small static config), not a database table... copying it
 * into per-tenant rows at provisioning time... is what lets a tenant customize its 'Vendedor' role
 * without touching every other tenant's."
 *
 * Lives in packages/shared (not apps/api or database) so both self-service tenant provisioning
 * (apps/api/src/auth — Prompt 04) and the demo-tenant seed script (database/seeds) consume the
 * exact same source of truth instead of two copies drifting apart. Kept as a single flat export
 * (no re-export barrel) — a `export *` barrel is what caused a real cross-module-system import bug
 * elsewhere in this codebase (see database/seeds/demo-tenant.ts's comment on schema/index.ts).
 *
 * The base RBAC *mechanism* (fixed catalog, tenant-toggleable assignment) is fully specified by
 * database.md. The exact permission-to-role matrix below follows the qualitative hints already
 * given per-permission in database.md's RBAC table (risk level, "rol Vendedor típico",
 * "Administrador únicamente", etc.) — it is a reasonable starting template, not a business rule
 * this architecture pins exhaustively. A tenant's Administrator can always edit/reassign after
 * provisioning (roles are not protected once copied, per the same doc section: "is_system_default...
 * is a label, not a protection mechanism").
 */
export const DEFAULT_ROLE_TEMPLATE_NAMES = ['Administrador', 'Supervisor', 'Vendedor', 'Bodega'] as const;

export type DefaultRoleTemplateName = (typeof DEFAULT_ROLE_TEMPLATE_NAMES)[number];

export const DEFAULT_ROLE_TEMPLATES: Record<DefaultRoleTemplateName, { description: string; permissionCodes: string[] }> = {
  Administrador: {
    description: 'Acceso completo a la configuracion y operacion del tenant.',
    permissionCodes: [
      'catalog.attributes.manage',
      'catalog.qr.manage',
      'pricing.policy.manage',
      'pricing.floor.view',
      'pricing.cost.view',
      'pricing.discount.request',
      'pricing.discount.approve',
      'inventory.transfers.request',
      'inventory.transfers.approve',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
      'inventory.returns.manage',
      'import.execute',
      'import.inventory',
      'core.users.locations.manage',
      'core.tenant.update',
      'core.users.read',
      'core.users.create',
      'core.users.update',
      'core.roles.read',
      'core.roles.assign',
      'products.view',
      'products.manage',
      'categories.view',
      'categories.manage',
      'warehouses.view',
      'warehouses.manage',
      'locations.view',
      'locations.manage',
      'inventory.view',
      'inventory.adjust',
      'administration.settings.view',
      'administration.settings.manage',
      'sales.customers.view',
      'sales.customers.manage',
      'sales.carts.manage',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.cancel',
      'sales.returns.view',
      'sales.returns.create',
    ],
  },
  Supervisor: {
    description: 'Aprueba excepciones y transferencias; visibilidad de costos.',
    permissionCodes: [
      'pricing.floor.view',
      'pricing.cost.view',
      'pricing.discount.approve',
      'inventory.transfers.approve',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
      'inventory.returns.manage',
      'products.view',
      'categories.view',
      'warehouses.view',
      'locations.view',
      'inventory.view',
      'inventory.adjust',
      'sales.customers.view',
      'sales.customers.manage',
      'sales.carts.manage',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.cancel',
      'sales.returns.view',
      'sales.returns.create',
    ],
  },
  Vendedor: {
    description: 'Vende y negocia dentro del rango autorizado; sin visibilidad de costos.',
    permissionCodes: [
      'pricing.floor.view',
      'pricing.discount.request',
      'products.view',
      'categories.view',
      'sales.customers.view',
      'sales.customers.manage',
      'sales.carts.manage',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.cancel',
      'sales.returns.view',
      'sales.returns.create',
    ],
  },
  Bodega: {
    description: 'Opera transferencias, recepciones y devoluciones en las ubicaciones asignadas.',
    permissionCodes: [
      'inventory.transfers.request',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
      'inventory.returns.manage',
      'products.view',
      'categories.view',
      'warehouses.view',
      'locations.view',
      'inventory.view',
      'inventory.adjust',
      'sales.returns.view',
    ],
  },
};
