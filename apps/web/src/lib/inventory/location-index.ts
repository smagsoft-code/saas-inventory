import { listLocations } from './locations';
import { listWarehouses } from './warehouses';

/**
 * Balances and movements come back with `locationId` only (`GAP-NAME-ENRICHMENT`). This resolves
 * ids to names from a single bounded fetch of each list (`pageSize: 100`) — the same bounded-list
 * approach F17-03/F17-05 use for category names. A tenant with more than 100 warehouses/locations
 * is beyond the tested range (recorded in f17-gaps.md).
 */
export interface LocationIndex {
  locationName: (id: string) => string;
  warehouseName: (locationId: string) => string;
}

export async function buildLocationIndex(canViewWarehouses: boolean): Promise<LocationIndex> {
  const [locations, warehouses] = await Promise.all([
    listLocations({ pageSize: 100 }).catch(() => null),
    canViewWarehouses ? listWarehouses({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
  ]);
  const locationById = new Map((locations?.data ?? []).map((l) => [l.id, l]));
  const warehouseById = new Map((warehouses?.data ?? []).map((w) => [w.id, w.name]));
  return {
    locationName: (id) => locationById.get(id)?.name ?? shortId(id),
    warehouseName: (locationId) => {
      const warehouseId = locationById.get(locationId)?.warehouseId;
      return (warehouseId && warehouseById.get(warehouseId)) || '—';
    },
  };
}

/** A short, stable label for an id we cannot resolve to a name. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
