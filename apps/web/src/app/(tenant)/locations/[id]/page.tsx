import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getLocation, listLocations } from '../../../../lib/inventory/locations';
import { getWarehouse } from '../../../../lib/inventory/warehouses';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { LocationForm } from '../location-form';

export const metadata = { title: 'Almacén · SaaS Inventory' };

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('locations.view')) {
    return (
      <PageContainer>
        <PageHeader title="Almacén" />
        <NoAccess message="Necesitas el permiso de almacenes para ver esta página." />
      </PageContainer>
    );
  }
  const canManage = checker.can('locations.manage');
  const canViewWarehouses = checker.can('warehouses.view');

  let location;
  try {
    location = await getLocation(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [warehouse, siblings] = await Promise.all([
    canViewWarehouses
      ? getWarehouse(location.warehouseId).catch(() => null)
      : Promise.resolve(null),
    listLocations({ warehouseId: location.warehouseId, pageSize: 100 }),
  ]);
  const warehouseName = warehouse?.name ?? location.warehouseId;
  const parentName = location.parentLocationId
    ? siblings.data.find((s) => s.id === location.parentLocationId)?.name ?? 'Otro almacén'
    : '—';

  return (
    <PageContainer>
      <PageHeader
        title={location.name}
        description={`${warehouseName} · ${location.code}`}
        actions={
          <Badge tone={statusTone(location.status)}>
            {location.status === 'active' ? 'Activo' : location.status === 'inactive' ? 'Inactivo' : location.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Detalles</h2>
          {canManage ? (
            <LocationForm
              mode="edit"
              location={location}
              warehouses={[{ id: location.warehouseId, name: warehouseName }]}
              parentCandidates={siblings.data.map((s) => ({
                id: s.id,
                warehouseId: s.warehouseId,
                name: s.name,
                code: s.code,
              }))}
            />
          ) : (
            <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Nombre</dt>
              <dd className="text-slate-900">{location.name}</dd>
              <dt className="text-slate-500">Código</dt>
              <dd className="text-slate-900">
                <code className="text-xs">{location.code}</code>
              </dd>
              <dt className="text-slate-500">Sucursal</dt>
              <dd className="text-slate-900">
                {canViewWarehouses ? (
                  <Link
                    href={`/warehouses/${location.warehouseId}`}
                    className="underline underline-offset-2"
                  >
                    {warehouseName}
                  </Link>
                ) : (
                  warehouseName
                )}
              </dd>
              <dt className="text-slate-500">Almacén padre</dt>
              <dd className="text-slate-900">{parentName}</dd>
              <dt className="text-slate-500">Vendible</dt>
              <dd className="text-slate-900">{location.isSellable ? 'Sí' : 'No — no vendible'}</dd>
            </dl>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
