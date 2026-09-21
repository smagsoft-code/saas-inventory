'use client';

import { useMemo } from 'react';
import type { PermissionCatalogItem } from '../../../lib/types/core';

// OUI-001: no hay traducción de `module` en el contrato (es texto libre en la tabla `permissions`,
// database.md#rbac-roles-permissions) — se traduce solo el rótulo visible, nunca el valor que
// viaja a la API (mismo patrón que USER_STATUS_LABELS en users/page.tsx).
const MODULE_LABELS: Record<string, string> = {
  core: 'Núcleo y administración',
  catalog: 'Catálogo',
  pricing: 'Precios',
  inventory: 'Inventario',
  import: 'Importación',
  administration: 'Configuración del tenant',
  sales: 'Ventas',
};

/**
 * Selector de permisos agrupado por módulo (§3/§13 del bloque ROLES/PERMISSIONS) — usado tanto al
 * crear un rol como al reemplazar el conjunto de permisos de uno existente. Presentacional puro:
 * el llamador es dueño del estado seleccionado.
 */
export function PermissionPicker({
  catalog,
  selected,
  onToggle,
  disabled = false,
}: {
  catalog: PermissionCatalogItem[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const byModule = useMemo(() => {
    const groups = new Map<string, PermissionCatalogItem[]>();
    for (const item of catalog) {
      const list = groups.get(item.module) ?? [];
      list.push(item);
      groups.set(item.module, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
    return [...groups.entries()].sort(([a], [b]) => (MODULE_LABELS[a] ?? a).localeCompare(MODULE_LABELS[b] ?? b));
  }, [catalog]);

  return (
    <div className="flex flex-col gap-4">
      {byModule.map(([module, items]) => (
        <fieldset key={module} className="rounded-md border border-slate-200 p-3" disabled={disabled}>
          <legend className="px-1 text-sm font-semibold text-slate-800">{MODULE_LABELS[module] ?? module}</legend>
          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {items.map((item) => (
              <label key={item.code} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.has(item.code)}
                  onChange={() => onToggle(item.code)}
                  disabled={disabled}
                />
                <span>
                  <span className="block text-slate-800">{item.description}</span>
                  <code className="text-[11px] text-slate-400">{item.code}</code>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
