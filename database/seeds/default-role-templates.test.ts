import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_TEMPLATE_NAMES, DEFAULT_ROLE_TEMPLATES } from './default-role-templates';

/** The exact set inserted by database/migrations/0001_platform_tables.sql, 0014_core_admin_permissions.sql,
 * and 0015_catalog_permissions.sql — kept in sync by hand since migrations are the authoritative
 * source and are never edited after being applied. */
const KNOWN_PERMISSION_CODES = new Set([
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
]);

describe('default role templates', () => {
  it('defines exactly the four documented roles', () => {
    expect(Object.keys(DEFAULT_ROLE_TEMPLATES).sort()).toEqual([...DEFAULT_ROLE_TEMPLATE_NAMES].sort());
  });

  it('every permission code referenced exists in the migration-managed catalog (0001_platform_tables.sql)', () => {
    for (const [roleName, template] of Object.entries(DEFAULT_ROLE_TEMPLATES)) {
      for (const code of template.permissionCodes) {
        expect(KNOWN_PERMISSION_CODES.has(code), `${roleName} references unknown permission code "${code}"`).toBe(
          true,
        );
      }
    }
  });

  it('no role has duplicate permission codes', () => {
    for (const [roleName, template] of Object.entries(DEFAULT_ROLE_TEMPLATES)) {
      expect(new Set(template.permissionCodes).size, `${roleName} has duplicate codes`).toBe(
        template.permissionCodes.length,
      );
    }
  });

  it('Administrador is a superset of every other role (full access, per its description)', () => {
    const adminCodes = new Set(DEFAULT_ROLE_TEMPLATES.Administrador.permissionCodes);
    for (const [roleName, template] of Object.entries(DEFAULT_ROLE_TEMPLATES)) {
      if (roleName === 'Administrador') continue;
      for (const code of template.permissionCodes) {
        expect(adminCodes.has(code), `Administrador is missing "${code}" granted to ${roleName}`).toBe(true);
      }
    }
  });

  it('Vendedor never has pricing.cost.view (typically restricted to Administrador/Supervisor)', () => {
    expect(DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes).not.toContain('pricing.cost.view');
  });

  it('core.users.locations.manage is Administrador-only, per its documented convention', () => {
    for (const [roleName, template] of Object.entries(DEFAULT_ROLE_TEMPLATES)) {
      if (roleName === 'Administrador') continue;
      expect(template.permissionCodes).not.toContain('core.users.locations.manage');
    }
  });
});
