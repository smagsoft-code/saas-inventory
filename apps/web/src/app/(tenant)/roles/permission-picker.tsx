'use client';

import { useMemo } from 'react';
import { describePermission, PERMISSION_MODULE_LABELS } from '../../../lib/core/permission-labels';
import type { PermissionCatalogItem } from '../../../lib/types/core';
import { HelpTip } from '../../../components/ui/help-tip';

/**
 * Selector de permisos agrupado por módulo (§3/§13 del bloque ROLES/PERMISSIONS) — usado tanto al
 * crear un rol como al reemplazar el conjunto de permisos de uno existente. Presentacional puro:
 * el llamador es dueño del estado seleccionado. Cada permiso se muestra con un nombre en lenguaje
 * llano y un icono de ayuda que resume qué permite (lib/core/permission-labels.ts). El `fieldset` no
 * lleva `disabled`: deshabilitaría también los iconos de ayuda; cada casilla se deshabilita sola.
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
      list.sort((a, b) => describePermission(a.code, a.description).label.localeCompare(describePermission(b.code, b.description).label, 'es'));
    }
    return [...groups.entries()].sort(([a], [b]) => (PERMISSION_MODULE_LABELS[a] ?? a).localeCompare(PERMISSION_MODULE_LABELS[b] ?? b));
  }, [catalog]);

  return (
    <div className="flex flex-col gap-4">
      {byModule.map(([module, items]) => (
        <fieldset key={module} className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-800">{PERMISSION_MODULE_LABELS[module] ?? module}</legend>
          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {items.map((item) => {
              const { label, help } = describePermission(item.code, item.description);
              return (
                <div key={item.code} className="flex items-start gap-2 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(item.code)}
                      onChange={() => onToggle(item.code)}
                      disabled={disabled}
                    />
                    <span className="text-slate-800">{label}</span>
                  </label>
                  <HelpTip label={`Ayuda sobre: ${label}`}>{help}</HelpTip>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
