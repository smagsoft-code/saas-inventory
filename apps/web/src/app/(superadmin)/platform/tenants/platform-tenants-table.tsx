'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '../../../../components/ui/badge';
import { Input, Select } from '../../../../components/ui/input';
import { Field } from '../../../../components/ui/field';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import {
  TENANT_STATUS_LABELS,
  tenantStatusTone,
  type PlatformTenant,
} from '../../../../lib/types/platform-tenant';

/**
 * The company list body (`S-SA-TENANTS`). A Client Component because the filtering, sorting and
 * search are genuine interaction over the already-fetched array — the endpoint has no server
 * params for any of it (`f17-super-admin.md` §2), so there is **no** extra request: everything
 * here works on the `tenants` prop.
 *
 * "no results" (a filter/search is active but nothing matches) is a distinct state from the page's
 * "no companies at all" empty state.
 */
type StatusFilter = 'all' | 'active' | 'suspended' | 'archived';
type KindFilter = 'all' | 'real' | 'demo';
type SortKey = 'created-desc' | 'created-asc' | 'name-asc';

export function PlatformTenantsTable({ tenants }: { tenants: PlatformTenant[] }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('created-desc');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = tenants.filter((t) => {
      if (status !== 'all' && t.status !== status) return false;
      if (kind === 'demo' && !t.isDemo) return false;
      if (kind === 'real' && t.isDemo) return false;
      if (needle && !t.name.toLowerCase().includes(needle) && !t.slug.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === 'name-asc') return a.name.localeCompare(b.name);
      const cmp = a.createdAt.localeCompare(b.createdAt);
      return sort === 'created-asc' ? cmp : -cmp;
    });
    return sorted;
  }, [tenants, query, status, kind, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Buscar">
          <Input
            type="search"
            placeholder="Nombre o slug"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field label="Estado">
          <Select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            <option value="all">Todos los estados</option>
            <option value="active">Activa</option>
            <option value="suspended">Suspendida</option>
            <option value="archived">Archivada</option>
          </Select>
        </Field>
        <Field label="Tipo">
          <Select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
            <option value="all">Todos los tipos</option>
            <option value="real">Real</option>
            <option value="demo">Demo</option>
          </Select>
        </Field>
        <Field label="Ordenar por">
          <Select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="created-desc">Más recientes primero</option>
            <option value="created-asc">Más antiguas primero</option>
            <option value="name-asc">Nombre (A–Z)</option>
          </Select>
        </Field>
      </div>

      <p className="text-xs text-slate-500" role="status">
        {filtered.length} de {tenants.length} {tenants.length === 1 ? 'empresa' : 'empresas'}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          title="Ninguna empresa coincide con estos filtros"
          description="Prueba con otro estado, tipo o término de búsqueda."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Empresa</TH>
              <TH>Slug</TH>
              <TH>Estado</TH>
              <TH>Tipo</TH>
              <TH>Creada</TH>
              <TH className="w-0">
                <span className="sr-only">Acciones</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((tenant) => (
              <TR key={tenant.id}>
                <TD className="font-medium">{tenant.name}</TD>
                <TD>
                  <code className="text-xs text-slate-500">{tenant.slug}</code>
                </TD>
                <TD>
                  <Badge tone={tenantStatusTone(tenant.status)}>
                    {TENANT_STATUS_LABELS[tenant.status] ?? tenant.status}
                  </Badge>
                </TD>
                <TD className="text-slate-500">{tenant.isDemo ? 'Demo' : 'Real'}</TD>
                <TD className="whitespace-nowrap text-slate-500">
                  {new Date(tenant.createdAt).toLocaleDateString('es')}
                </TD>
                <TD>
                  <Link
                    href={`/platform/tenants/${tenant.id}`}
                    className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                  >
                    Ver
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
