import { listLocations } from './locations';
import { listWarehouses } from './warehouses';
import type { Location } from '../types/inventory';

/**
 * Balances and movements come back with `locationId` only (`GAP-NAME-ENRICHMENT`). This resolves
 * ids to names from a single bounded fetch of each list (`pageSize: 100`) — the same bounded-list
 * approach F17-03/F17-05 use for category names. A tenant with more than 100 warehouses/locations
 * is beyond the tested range (recorded in f17-gaps.md).
 *
 * `locations` is the raw list this fetched, so a page that also needs it for a filter selector
 * reuses it instead of issuing a second `GET /locations` (F17-AUDIT-01: no duplicate fetch).
 */
export interface LocationIndex {
  locationName: (id: string) => string;
  warehouseName: (locationId: string) => string;
  /** Every location the index could see (all statuses), for a page's own location filter. */
  locations: Location[];
}

export async function buildLocationIndex(canViewWarehouses: boolean): Promise<LocationIndex> {
  const [locations, warehouses] = await Promise.all([
    listLocations({ pageSize: 100 }).catch(() => null),
    canViewWarehouses ? listWarehouses({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
  ]);
  const locationList = locations?.data ?? [];
  const locationById = new Map(locationList.map((l) => [l.id, l]));
  const warehouseById = new Map((warehouses?.data ?? []).map((w) => [w.id, w.name]));
  return {
    locationName: (id) => locationById.get(id)?.name ?? shortId(id),
    warehouseName: (locationId) => {
      const warehouseId = locationById.get(locationId)?.warehouseId;
      return (warehouseId && warehouseById.get(warehouseId)) || '—';
    },
    locations: locationList,
  };
}

/** A short, stable label for an id we cannot resolve to a name. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
