import { buildLocationIndex, type LocationIndex } from '../inventory/location-index';
import { getLocationScope, type LocationScope } from '../inventory/location-scope';

export interface LocationFilter {
  /** Locations the caller may pick (their own scope, ADR-0024), by name, with their Sucursal. */
  options: { id: string; name: string; warehouseId: string }[];
  /** The Sucursales that contain at least one of `options`. */
  warehouses: { id: string; name: string }[];
  /** Only an unrestricted user may pick "Todos los almacenes" / "Todas las sucursales". */
  allowAll: boolean;
  /** What is selected when nothing valid was asked for (undefined = "Todos"). */
  defaultId: string | undefined;
  defaultWarehouseId: string | undefined;
  /** The Almacén actually applied to the screen's queries. */
  selectedId: string | undefined;
  /** The Sucursal actually applied (the chosen one, or the Almacén's own). */
  selectedWarehouseId: string | undefined;
  /** Raw location/warehouse names for table cells. */
  index: LocationIndex;
}

/**
 * The Sucursal + Almacén filters of the history screens (Ventas, Aprobaciones, Devoluciones). The
 * options are the locations in the caller's own scope; an unrestricted user (founding
 * Administrador) also gets "Todos"; a restricted user always has one Almacén selected — the only
 * one, or the first by name. A `requested` id outside the options falls back to the default; an
 * Almacén that does not belong to the requested Sucursal is dropped. This is what the screen
 * *offers*; the backend separately enforces the read scope (ADR-0024/0035).
 */
export async function resolveLocationFilter(
  canViewWarehouses: boolean,
  requested: string | undefined,
  requestedWarehouse?: string | undefined,
): Promise<LocationFilter> {
  const [scope, index] = await Promise.all([
    getLocationScope().catch((): LocationScope => ({ unrestricted: false, locationIds: [] })),
    buildLocationIndex(canViewWarehouses),
  ]);
  const options = index.locations
    .filter((l) => scope.unrestricted || scope.locationIds.includes(l.id))
    .map((l) => ({ id: l.id, name: l.name, warehouseId: l.warehouseId }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const warehouseOf = (locationId: string | undefined): string | undefined => options.find((l) => l.id === locationId)?.warehouseId;

  const warehouseNames = new Map<string, string>();
  for (const l of options) {
    if (!warehouseNames.has(l.warehouseId)) warehouseNames.set(l.warehouseId, index.warehouseName(l.id));
  }
  const warehouses = [...warehouseNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const allowAll = scope.unrestricted;
  const defaultId = allowAll ? undefined : options[0]?.id;
  const defaultWarehouseId = warehouseOf(defaultId);

  const validWarehouse = warehouses.some((w) => w.id === requestedWarehouse) ? requestedWarehouse : undefined;
  let selectedId = options.some((l) => l.id === requested) ? requested : undefined;
  if (selectedId && validWarehouse && warehouseOf(selectedId) !== validWarehouse) {
    selectedId = undefined;
  }
  let selectedWarehouseId = validWarehouse ?? warehouseOf(selectedId);
  if (!selectedId && !allowAll) {
    // A restricted user always has one Almacén selected: the first one (of the chosen Sucursal, if any).
    selectedId = options.find((l) => !selectedWarehouseId || l.warehouseId === selectedWarehouseId)?.id ?? defaultId;
    selectedWarehouseId = warehouseOf(selectedId);
  }
  return { options, warehouses, allowAll, defaultId, defaultWarehouseId, selectedId, selectedWarehouseId, index };
}
