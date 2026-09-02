import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getWarehouse } from '../../../../lib/inventory/warehouses';
import { listLocations } from '../../../../lib/inventory/locations';
import { ADDRESS_FIELDS, ADDRESS_FIELD_LABELS } from '../../../../lib/types/inventory';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { WarehouseForm } from '../warehouse-form';

export const metadata = { title: 'Warehouse · SaaS Inventory' };

export default async function WarehouseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('warehouses.view')) {
    return (
      <PageContainer>
        <PageHeader title="Warehouse" />
        <NoAccess message="You need the warehouses permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('warehouses.manage');
  const canViewLocations = checker.can('locations.view');

  let warehouse;
  try {
    warehouse = await getWarehouse(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const locations = canViewLocations
    ? await listLocations({ warehouseId: id, pageSize: 100 })
    : null;

  const addressRows = ADDRESS_FIELDS.map((key) => ({
    label: ADDRESS_FIELD_LABELS[key],
    value: typeof warehouse.address?.[key] === 'string' ? (warehouse.address[key] as string) : '',
  })).filter((row) => row.value.length > 0);

  return (
    <PageContainer>
      <PageHeader
        title={warehouse.name}
        description={warehouse.code}
        actions={<Badge tone={statusTone(warehouse.status)}>{warehouse.status}</Badge>}
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Details</h2>
          {canManage ? (
            <WarehouseForm mode="edit" warehouse={warehouse} />
          ) : (
            <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd className="text-slate-900">{warehouse.name}</dd>
              <dt className="text-slate-500">Code</dt>
              <dd className="text-slate-900">
                <code className="text-xs">{warehouse.code}</code>
              </dd>
              {addressRows.length === 0 ? (
                <>
                  <dt className="text-slate-500">Address</dt>
                  <dd className="text-slate-900">—</dd>
                </>
              ) : (
                addressRows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-slate-500">{row.label}</dt>
                    <dd className="text-slate-900">{row.value}</dd>
                  </div>
                ))
              )}
            </dl>
          )}
        </CardBody>
      </Card>

      {canViewLocations && locations && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Locations</h2>
              <Link
                href={`/locations?warehouseId=${warehouse.id}`}
                className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
              >
                Manage locations
              </Link>
            </div>
            {locations.data.length === 0 ? (
              <p className="text-sm text-slate-500">This warehouse has no locations yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {locations.data.map((location) => (
                  <li key={location.id} className="flex items-center gap-2">
                    <Link
                      href={`/locations/${location.id}`}
                      className="font-medium text-slate-800 underline-offset-2 hover:underline"
                    >
                      {location.name}
                    </Link>
                    <code className="text-xs text-slate-400">{location.code}</code>
                    {!location.isSellable && <Badge tone="warning">non-sellable</Badge>}
                    {location.status !== 'active' && (
                      <Badge tone={statusTone(location.status)}>{location.status}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}
