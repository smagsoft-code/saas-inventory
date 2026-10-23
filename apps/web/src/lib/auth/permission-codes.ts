/**
 * The permission codes the backend actually recognises. This is a mirror, not a source of truth:
 * the authority is `packages/shared`'s `DEFAULT_ROLE_TEMPLATES` and the `*_permissions` seed
 * migrations (`0001`, `0014`–`0017`, `0023`, `0026`, `0027`). Kept local so the frontend does not
 * take a runtime dependency on `@saas-inventory/shared` (which pulls `uuidv7` into the bundle) —
 * the same trade-off `lib/types/*` already makes for DTO shapes.
 *
 * FASE 16 only *consumes* a couple of these (navigation gating); the full list is here so FASE 17
 * modules and the `PermissionCode` type have one place to reference and typos surface at compile
 * time rather than as a silently-always-false `can(...)`.
 */
export const PERMISSION_CODES = [
  // core / administration
  'core.tenant.update',
  'core.users.read',
  'core.users.create',
  'core.users.update',
  'core.users.locations.manage',
  'core.roles.read',
  'core.roles.assign',
  'core.roles.manage',
  'administration.settings.view',
  'administration.settings.manage',
  // catalog
  'catalog.attributes.manage',
  'catalog.qr.manage',
  'products.view',
  'products.manage',
  'categories.view',
  'categories.manage',
  // pricing
  'pricing.policy.manage',
  'pricing.floor.view',
  'pricing.cost.view',
  'pricing.discount.request',
  'pricing.discount.approve',
  // inventory
  'warehouses.view',
  'warehouses.manage',
  'locations.view',
  'locations.manage',
  'inventory.view',
  'inventory.adjust',
  'inventory.transfers.request',
  'inventory.transfers.approve',
  'inventory.transfers.dispatch',
  'inventory.transfers.receive',
  'inventory.returns.manage',
  // import
  'import.execute',
  'import.inventory',
  // sales
  'sales.customers.view',
  'sales.customers.manage',
  'sales.carts.manage',
  'sales.orders.view',
  'sales.orders.view_all',
  'sales.orders.create',
  'sales.orders.cancel',
  'sales.returns.view',
  'sales.returns.create',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];
