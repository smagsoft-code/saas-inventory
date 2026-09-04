import { serverApiFetch } from '../api/server';

/**
 * A tenant user's location-scoped-authorization assignments (ADR-0024) —
 * `GET/PUT /api/v1/users/:userId/locations`, permission `core.users.locations.manage`.
 *
 * **ADR-0024 semantics (critical):** a user with **zero** assignment rows is **unrestricted**
 * (may operate on every tenant location), not "assigned to nothing". `PUT` replaces the whole set;
 * an empty `locationIds` array clears the restriction. The response carries `locationId` only —
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
