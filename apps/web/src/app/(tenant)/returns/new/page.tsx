import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listOrders } from '../../../../lib/sales/orders';
import { listWarehouses } from '../../../../lib/inventory/warehouses';
import { getLocationScope, type LocationScope } from '../../../../lib/inventory/location-scope';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Alert } from '../../../../components/ui/alert';
import { NoAccess } from '../../../../components/ui/no-access';
import { ReturnForm, type OrderOption, type WarehouseOption, type LocationOption } from './return-form';

export const metadata = { title: 'Nueva devolución · SaaS Inventory' };

/**
 * Create a sales return (`S-RET-NEW`) — `POST /api/v1/sales-returns` (`sales.returns.create`,
 * `Idempotency-Key`). Only a **confirmed** order can be returned (the backend re-checks). There is
 * no order text search (`GAP-SEARCH`), so the order picker is a bounded `pageSize: 100`
 * `status=confirmed` list; the client then fetches the chosen order's lines + its existing returns
 * to show a returnable-quantity hint (the backend is the authority on what remains returnable).
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.returns.create')) {
    return (
      <PageContainer>
        <PageHeader title="Nueva devolución" />
        <NoAccess message="Necesitas el permiso de creación de devoluciones para presentar una devolución." />
      </PageContainer>
    );
  }

  const sp = await searchParams;
  const preselectOrderId = sp.orderId || undefined;

  const canViewWarehouses = checker.can('warehouses.view');
  const [orders, warehouses, index, scope] = await Promise.all([
    listOrders({ status: 'confirmed', pageSize: 100 }).catch(() => null),
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    buildLocationIndex(canViewWarehouses),
    getLocationScope().catch((): LocationScope => ({ unrestricted: false, locationIds: [] })),
  ]);

  const orderOptions: OrderOption[] = (orders?.data ?? []).map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customer.name,
  }));
  // Only the almacenes the caller may operate at (ADR-0024/0035) — a return received anywhere else
  // could not be opened afterwards (the detail is 404 outside scope) and the API now refuses it.
  const locationOptions: LocationOption[] = index.locations
    .filter((location) => location.status === 'active' && (scope.unrestricted || scope.locationIds.includes(location.id)))
    .map((location) => ({ id: location.id, warehouseId: location.warehouseId, name: location.name }));
  const warehouseOptions: WarehouseOption[] = (warehouses?.data ?? [])
    .filter((w) => locationOptions.some((l) => l.warehouseId === w.id))
    .map((w) => ({ id: w.id, name: w.name }));

  return (
    <PageContainer>
      <PageHeader title="Nueva devolución" description="Presenta una devolución contra un pedido confirmado." />

      {orderOptions.length === 0 ? (
        <Card>
          <CardBody>
            <Alert tone="info">
              No hay pedidos confirmados para devolver.{' '}
              <Link href="/sales" className="underline">
                Ir al historial de ventas
              </Link>
              .
            </Alert>
          </CardBody>
        </Card>
      ) : warehouseOptions.length === 0 || locationOptions.length === 0 ? (
        <Card>
          <CardBody>
            <Alert tone="warning">
              No hay ninguna sucursal o almacén activo disponible para recibir la mercancía
              devuelta.{' '}
              <Link href="/locations" className="underline">
                Agregar o activar un almacén
              </Link>
              .
            </Alert>
          </CardBody>
        </Card>
      ) : (
        <ReturnForm
          orders={orderOptions}
          warehouses={warehouseOptions}
          locations={locationOptions}
          {...(preselectOrderId ? { preselectOrderId } : {})}
        />
      )}

      <Link href="/returns" className="text-sm font-medium text-slate-500 hover:underline">
        Volver a devoluciones
      </Link>
    </PageContainer>
  );
}
