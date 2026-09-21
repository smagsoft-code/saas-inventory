import { serverApiFetch } from '../api/server';

/**
 * A tenant user's location-scoped-authorization assignments (ADR-0024/ADR-0035) —
 * `GET/PUT /api/v1/users/:userId/locations`, permission `core.users.locations.manage`.
 *
 * **ADR-0035 semantics (critical, supersedes ADR-0024's original default):** a user with **zero**
 * assignment rows can operate on **no** location — not "unrestricted" — except the tenant's
 * founding, system-default "Administrador" role, which the backend always allows regardless of
 * this table's contents (a structural exception to avoid a tenant-bootstrap deadlock, see
 * ADR-0035). `PUT` replaces the whole set; an empty `locationIds` array means "no locations
 * assigned", not "unrestricted", for every other role. The response carries `locationId` only —
 * names are resolved from the bounded `GET /locations` fetch (`GAP-NAME-ENRICHMENT`).
 *
 * `userId` is a path segment; `tenantId` is resolved server-side (`@CurrentTenant()`), never sent.
 * The `PUT` mutation goes through `apiFetch` in the client editor (CSRF handled there).
 */
export interface UserLocationAssignment {
  locationId: string;
  assignedAt: string;
  assignedBy?: string;
}

export async function listUserLocations(userId: string): Promise<UserLocationAssignment[]> {
  return serverApiFetch<UserLocationAssignment[]>(`/api/v1/users/${userId}/locations`);
}
