/**
 * The fixed, application-level role template copied into a newly-created tenant's
 * roles/role_permissions at provisioning time — database.md#rbac-roles-permissions:
 * "The template itself lives in application code (or a small static config), not a database
 * table... copying it into per-tenant rows at provisioning time... is what lets a tenant
 * customize its 'Vendedor' role without touching every other tenant's."
 *
 * The base RBAC *mechanism* (fixed catalog, tenant-toggleable assignment) is fully specified by
 * database.md. The exact permission-to-role matrix below follows the qualitative hints already
 * given per-permission in database.md's RBAC table (risk level, "rol Vendedor típico",
 * "Administrador únicamente", etc.) — it is a reasonable starting template, not a business rule
 * this architecture pins exhaustively. Whichever phase actually builds tenant provisioning /
 * an RBAC configuration UI (FASE 4/7) owns refining it; a tenant's Administrator can always
 * edit/reassign after provisioning (roles are not protected once copied, per the same doc
 * section: "is_system_default... is a label, not a protection mechanism").
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
    ],
  },
  Vendedor: {
    description: 'Vende y negocia dentro del rango autorizado; sin visibilidad de costos.',
    permissionCodes: ['pricing.floor.view', 'pricing.discount.request'],
  },
  Bodega: {
    description: 'Opera transferencias y recepciones en las ubicaciones asignadas.',
    permissionCodes: ['inventory.transfers.request', 'inventory.transfers.dispatch', 'inventory.transfers.receive'],
  },
};
