import { Badge } from '../../../components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import type { Role } from '../../../lib/types/core';

/**
 * Pure, read-only presentation of the tenant role catalogue (`S-ROLES-LIST`). No interaction —
 * role/permission CRUD does not exist (`GAP-ROLE-CRUD`, future). Every field comes straight from
 * `RoleResponseDto`; `permissionCodes` is rendered as a compact wrapped list of chips.
 */
export function RolesTable({ roles }: { roles: Role[] }): React.JSX.Element {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Role</TH>
          <TH>Description</TH>
          <TH>Type</TH>
          <TH>Permissions</TH>
        </TR>
      </THead>
      <TBody>
        {roles.map((role) => (
          <TR key={role.id}>
            <TD className="whitespace-nowrap font-medium align-top">{role.name}</TD>
            <TD className="text-slate-500 align-top">{role.description || '—'}</TD>
            <TD className="align-top">
              <Badge tone={role.isSystemDefault ? 'neutral' : 'success'}>
                {role.isSystemDefault ? 'System default' : 'Custom'}
              </Badge>
            </TD>
            <TD className="align-top">
              {role.permissionCodes.length === 0 ? (
                <span className="text-xs text-slate-400">No permissions</span>
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
              <p className="mt-1 text-[11px] text-slate-400">{role.permissionCodes.length} permission(s)</p>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
