import { serverApiFetch } from '../api/server';
import type { Role } from '../types/core';

/**
 * Server-side reads of the tenant's role catalogue (ROLES/PERMISSIONS block — closes
 * `GAP-ROLE-CRUD`). `GET /api/v1/roles` is a plain array — no pagination, no search, no sort in
 * the contract. Mutations (create/rename/delete/replace-permissions) happen client-side via
 * `apiFetch` directly in the form components, same convention as `create-user-form.tsx` — there is
 * no mutation wrapper here.
 */
export async function listRoles(): Promise<Role[]> {
  return serverApiFetch<Role[]>('/api/v1/roles');
}

export async function getRole(id: string): Promise<Role> {
  return serverApiFetch<Role>(`/api/v1/roles/${id}`);
}
