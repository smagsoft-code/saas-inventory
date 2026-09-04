import { serverApiFetch } from '../api/server';
import type { Role } from '../types/core';

/**
 * Server-side read of the tenant's role catalogue (`GET /api/v1/roles`, permission
 * `core.roles.read`). A plain array — no pagination, no search, no sort in the contract.
 *
 * Roles are the fixed `DEFAULT_ROLE_TEMPLATES` set (ADR-0009 / database.md), editable only via
 * direct DB access — there is **no** create/edit/delete endpoint (`GAP-ROLE-CRUD`, future). This
 * helper backs the read-only `S-ROLES-LIST` screen and the role selector on the user forms.
 */
export async function listRoles(): Promise<Role[]> {
  return serverApiFetch<Role[]>('/api/v1/roles');
}
