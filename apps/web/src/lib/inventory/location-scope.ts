import { serverApiFetch } from '../api/server';

/**
 * `GET /api/v1/inventory/location-scope` — the current user's own ADR-0024 operating scope
 * (F17-TRANSFERS-AUDIT §6). No permission beyond authentication; every tenant user can read their
 * own scope, the same posture as `/auth/me`. `unrestricted: true` (the founding Administrador
 * exception, ADR-0035) means every location in the tenant is in scope; otherwise `locationIds` is
 * the exhaustive, explicit list.
 */
export interface LocationScope {
  unrestricted: boolean;
  locationIds: string[];
}

export async function getLocationScope(): Promise<LocationScope> {
  return serverApiFetch<LocationScope>('/api/v1/inventory/location-scope');
}
