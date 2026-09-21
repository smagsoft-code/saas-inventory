import Link from 'next/link';
import { Badge } from '../../../components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import type { Role } from '../../../lib/types/core';
import { RoleDeleteButton } from './role-delete-button';

/**
 * Presentation of the tenant role catalogue (`S-ROLES-LIST`). Every field comes straight from
 * `RoleResponseDto`; `permissionCodes` is rendered as a compact wrapped list of chips.
 * `canManage` (`core.roles.manage`) gates the Editar/Eliminar row actions — `is_system_default`
 * grants no protection (database.md#rbac-roles-permissions: "a label, not a protection
 * mechanism"), so a predefined role gets the same actions as a custom one, only the "Predefinido
 * del sistema" badge differs.
 */
export function RolesTable({ roles, canManage }: { roles: Role[]; canManage: boolean }): React.JSX.Element {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Rol</TH>
          <TH>Descripción</TH>
          <TH>Tipo</TH>
          <TH>Permisos</TH>
          {canManage && <TH>Acciones</TH>}
        </TR>
      </THead>
      <TBody>
        {roles.map((role) => (
          <TR key={role.id}>
            <TD className="whitespace-nowrap font-medium align-top">
              {canManage ? (
                <Link href={`/roles/${role.id}`} className="underline">
                  {role.name}
                </Link>
              ) : (
                role.name
              )}
              {role.isAssignedToCaller && <span className="ml-1.5 text-[11px] font-normal text-slate-400">(tu rol)</span>}
            </TD>
            <TD className="text-slate-500 align-top">{role.description || '—'}</TD>
            <TD className="align-top">
              <Badge tone={role.isSystemDefault ? 'neutral' : 'success'}>
                {role.isSystemDefault ? 'Predeterminado del sistema' : 'Personalizado'}
              </Badge>
            </TD>
            <TD className="align-top">
              {role.permissionCodes.length === 0 ? (
                <span className="text-xs text-slate-400">Sin permisos</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {[...role.permissionCodes].sort().map((code) => (
                    <code
                      key={code}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                    >
                      {code}
                    </code>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-400">{role.permissionCodes.length} permiso(s)</p>
            </TD>
            {canManage && (
              <TD className="align-top">
                <div className="flex flex-col items-end gap-1.5">
                  <Link href={`/roles/${role.id}`} className="text-xs font-medium text-slate-700 underline">
                    Editar
                  </Link>
                  <RoleDeleteButton roleId={role.id} roleName={role.name} />
                </div>
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
