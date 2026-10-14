import { buildLocationIndex, type LocationIndex } from '../inventory/location-index';
import { getLocationScope, type LocationScope } from '../inventory/location-scope';

export interface LocationFilter {
  /** Locations the caller may pick (their own scope, ADR-0024), by name. */
  options: { id: string; name: string }[];
  /** Only an unrestricted user may pick "Todos los almacenes". */
  allowAll: boolean;
  /** What is selected when nothing valid was asked for (undefined = "Todos"). */
  defaultId: string | undefined;
  /** The Almacén actually applied to the screen's queries. */
  selectedId: string | undefined;
  /** Raw location/warehouse names for table cells. */
  index: LocationIndex;
}

/**
 * The Almacén filter of the history screens (Ventas, Aprobaciones, Devoluciones). The options are
 * the locations in the caller's own scope; an unrestricted user (founding Administrador) also gets
 * "Todos"; a restricted user always has one selected — the only one, or the first by name. A
 * `requested` id outside the options falls back to the default. This is what the screen *offers*;
 * order/return reads are not enforced per location by the backend (`GAP-ORDERS-LOCATION`).
 */
export async function resolveLocationFilter(canViewWarehouses: boolean, requested: string | undefined): Promise<LocationFilter> {
  const [scope, index] = await Promise.all([
    getLocationScope().catch((): LocationScope => ({ unrestricted: false, locationIds: [] })),
    buildLocationIndex(canViewWarehouses),
  ]);
  const options = index.locations
    .filter((l) => scope.unrestricted || scope.locationIds.includes(l.id))
    .map((l) => ({ id: l.id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const allowAll = scope.unrestricted;
  const defaultId = allowAll ? undefined : options[0]?.id;
  const selectedId = options.some((l) => l.id === requested) ? requested : defaultId;
  return { options, allowAll, defaultId, selectedId, index };
}
