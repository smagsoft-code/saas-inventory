import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listLocations } from '../../../lib/inventory/locations';
import { listWarehouses } from '../../../lib/inventory/warehouses';
import type { Location } from '../../../lib/types/inventory';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Almacenes · SaaS Inventory' };

const PAGE_SIZE = 20;
type StatusFilter = 'active' | 'inactive' | undefined;

function parseStatus(value: string | undefined): StatusFilter {
  return value === 'active' || value === 'inactive' ? value : undefined;
}

/**
 * Location list (`S-LOC-LIST`) — `GET /api/v1/locations` (`locations.view`), offset paginated,
 * `warehouseId` and `status` the only filters (no search / sort in the backend contract — not
 * invented). The warehouse column resolves names from a single `pageSize: 100` warehouse fetch.
 */
export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; warehouseId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('locations.view')) {
    return (
      <PageContainer>
        <PageHeader title="Almacenes" />
        <NoAccess message="Necesitas el permiso de almacenes para ver esta página." />
      </PageContainer>
    );
  }
  const canManage = checker.can('locations.manage');
  const canViewWarehouses = checker.can('warehouses.view');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = parseStatus(sp.status);
  const warehouseId = sp.warehouseId || undefined;

  const [result, warehouses] = await Promise.all([
    listLocations({
      page,
      pageSize: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    }),
    canViewWarehouses ? listWarehouses({ pageSize: 100 }) : Promise.resolve(null),
  ]);
  const warehouseName = new Map<string, string>(
    (warehouses?.data ?? []).map((w) => [w.id, w.name]),
  );

  function buildHref(next: {
    page?: number;
    status?: StatusFilter;
    warehouseId?: string | undefined;
  }): string {
    const params = new URLSearchParams();
    const nextStatus = next.status !== undefined ? next.status : status;
    const nextWarehouse = 'warehouseId' in next ? next.warehouseId : warehouseId;
    if (nextStatus) params.set('status', nextStatus);
    if (nextWarehouse) params.set('warehouseId', nextWarehouse);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/locations${params.toString() ? `?${params}` : ''}`;
  }

  const statusFilters: { label: string; value: StatusFilter }[] = [
    { label: 'Todos', value: undefined },
    { label: 'Activos', value: 'active' },
    { label: 'Inactivos', value: 'inactive' },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Almacenes"
        description="Los lugares dentro de una sucursal donde el stock está físicamente."
        actions={canManage ? <ButtonLink href="/locations/new">Nuevo almacén</ButtonLink> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {statusFilters.map((f) => {
            const active = status === f.value;
            return (
              <Link
                key={f.label}
                href={buildHref({ status: f.value })}
                aria-current={active ? 'true' : undefined}
                className={
                  active
                    ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
                }
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        {warehouses && warehouses.data.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ warehouseId: undefined })}
              aria-current={!warehouseId ? 'true' : undefined}
              className={
                !warehouseId
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
              }
            >
              Todas las sucursales
            </Link>
            {warehouses.data.map((w) => {
              const active = warehouseId === w.id;
              return (
                <Link
                  key={w.id}
                  href={buildHref({ warehouseId: w.id })}
                  aria-current={active ? 'true' : undefined}
                  className={
                    active
                      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
                  }
                >
                  {w.name}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {result.data.length === 0 ? (
        status || warehouseId ? (
          <EmptyState
            title="Ningún almacén coincide con este filtro"
            description="Prueba con otra sucursal o estado."
          />
        ) : (
          <EmptyState
            title="Aún no hay almacenes"
            description="Crea primero una sucursal — viene con un almacén «General» por defecto."
            action={canManage ? <ButtonLink href="/locations/new">Nuevo almacén</ButtonLink> : undefined}
          />
        )
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Código</TH>
                <TH>Sucursal</TH>
                <TH>Vendible</TH>
                <TH>Estado</TH>
                <TH className="w-0">
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((location: Location) => (
                <TR key={location.id}>
                  <TD className="font-medium">{location.name}</TD>
                  <TD className="text-slate-500">
                    <code className="text-xs">{location.code}</code>
                  </TD>
                  <TD className="text-slate-500">
                    {warehouseName.get(location.warehouseId) ?? '—'}
                  </TD>
                  <TD>
                    {location.isSellable ? (
                      <span className="text-slate-500">Sí</span>
                    ) : (
                      <Badge tone="warning">No vendible</Badge>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(location.status)}>
                      {location.status === 'active' ? 'Activo' : location.status === 'inactive' ? 'Inactivo' : location.status}
                    </Badge>
                  </TD>
                  <TD>
                    <Link
                      href={`/locations/${location.id}`}
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      {canManage ? 'Editar' : 'Ver'}
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={result.meta.page}
            pageSize={result.meta.pageSize}
            total={result.meta.total}
            totalPages={result.meta.totalPages}
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
