'use client';

import { useMemo } from 'react';

export interface LocationScopeOption {
  id: string;
  name: string;
  warehouseId: string;
  warehouseName: string;
  status: string;
}

/**
 * Selector de alcance operativo agrupado por almacén (§3 del bloque ROLES/ALCANCE) — "Almacén
 * Principal" como encabezado, sus ubicaciones debajo. Presentacional puro; usado tanto por
 * `LocationAccess` (edición, `/users/[id]`) como por `CreateUserForm` (creación, `/users/new`),
 * ambos contra el mismo endpoint existente `PUT /users/:id/locations` — ningún mecanismo paralelo.
 *
 * ADR-0035 (reemplaza el default de ADR-0024): una ubicación vacía ya NO significa "sin
 * restricción" — significa que el usuario no puede operar inventario en ningún almacén hasta que
 * se le asigne al menos una ubicación. La única excepción es el rol predefinido "Administrador" de
 * cada tenant, que siempre está desrestringido por diseño (ver `isFoundingAdministrador`) — cuando
 * aplica, el llamador debe mostrar el aviso correspondiente en vez de este picker.
 */
export function LocationScopePicker({
  locations,
  restricted,
  onRestrictedChange,
  selected,
  onToggle,
  disabled = false,
}: {
  locations: LocationScopeOption[];
  restricted: boolean;
  onRestrictedChange: (restricted: boolean) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const byWarehouse = useMemo(() => {
    const groups = new Map<string, { warehouseName: string; locations: LocationScopeOption[] }>();
    for (const location of locations) {
      const group = groups.get(location.warehouseId) ?? { warehouseName: location.warehouseName, locations: [] };
      group.locations.push(location);
      groups.set(location.warehouseId, group);
    }
    return [...groups.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
  }, [locations]);

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="sr-only">Alcance operativo</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="location-scope-mode"
            className="mt-0.5"
            checked={!restricted}
            onChange={() => onRestrictedChange(false)}
          />
          <span>
            <span className="font-medium text-slate-800">Sin ubicación asignada</span>
            <span className="block text-xs text-amber-700">
              No podrá vender, ajustar inventario ni operar transferencias en ningún almacén hasta que se le asigne al menos una ubicación.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="location-scope-mode"
            className="mt-0.5"
            checked={restricted}
            onChange={() => onRestrictedChange(true)}
          />
          <span>
            <span className="font-medium text-slate-800">Asignar almacenes/ubicaciones</span>
            <span className="block text-xs text-slate-500">El usuario solo podrá operar inventario en las ubicaciones seleccionadas.</span>
          </span>
        </label>
      </fieldset>

      {restricted && (
        <div className="flex flex-col gap-3">
          {byWarehouse.length === 0 ? (
            <p className="text-sm text-slate-500">Esta empresa no tiene almacenes/ubicaciones activos.</p>
          ) : (
            byWarehouse.map((group) => (
              <fieldset key={group.warehouseName} className="rounded-md border border-slate-200 p-3" disabled={disabled}>
                <legend className="px-1 text-sm font-semibold text-slate-800">{group.warehouseName}</legend>
                <div className="mt-1 flex flex-col gap-1.5">
                  {group.locations.map((location) => (
                    <label key={location.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected.has(location.id)} onChange={() => onToggle(location.id)} />
                      <span className="text-slate-800">{location.name}</span>
                      {location.status !== 'active' && <span className="text-xs text-amber-700">(inactivo)</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))
          )}
        </div>
      )}
    </div>
  );
}
