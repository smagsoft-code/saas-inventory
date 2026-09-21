import { serverApiFetch } from '../api/server';
import type { PermissionCatalogItem } from '../types/core';

/** Server-side read of the platform-wide permission catalog (`GET /api/v1/permissions`,
 * `core.roles.read`) — backs the role editor's "group by module" permission picker. Never
 * tenant-specific; the same catalog every tenant's roles draw from. */
export async function listPermissionCatalog(): Promise<PermissionCatalogItem[]> {
  return serverApiFetch<PermissionCatalogItem[]>('/api/v1/permissions');
}
