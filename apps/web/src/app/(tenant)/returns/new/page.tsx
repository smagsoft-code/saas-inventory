import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listOrders } from '../../../../lib/sales/orders';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Alert } from '../../../../components/ui/alert';
import { NoAccess } from '../../../../components/ui/no-access';
import { ReturnForm, type OrderOption, type LocationOption } from './return-form';

export const metadata = { title: 'New return · SaaS Inventory' };

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
        <PageHeader title="New return" />
        <NoAccess message="You need the create-returns permission to file a return." />
      </PageContainer>
    );
  }

  const sp = await searchParams;
  const preselectOrderId = sp.orderId || undefined;

  const [orders, index] = await Promise.all([
    listOrders({ status: 'confirmed', pageSize: 100 }).catch(() => null),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);

  const orderOptions: OrderOption[] = (orders?.data ?? []).map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customer.name,
  }));
  const locationOptions: LocationOption[] = index.locations
    .filter((location) => location.status === 'active')
    .map((location) => ({ id: location.id, name: location.name }));

  return (
    <PageContainer>
      <PageHeader title="New return" description="File a return against a confirmed order." />

      {orderOptions.length === 0 ? (
        <Card>
          <CardBody>
            <Alert tone="info">
              There are no confirmed orders to return.{' '}
              <Link href="/sales" className="underline">
                Go to sales history
              </Link>
              .
            </Alert>
          </CardBody>
        </Card>
      ) : locationOptions.length === 0 ? (
        <Card>
          <CardBody>
            <Alert tone="warning">
              No active location is available to receive the returned goods.{' '}
              <Link href="/locations" className="underline">
                Add or activate a location
              </Link>
              .
            </Alert>
          </CardBody>
        </Card>
      ) : (
        <ReturnForm
          orders={orderOptions}
          locations={locationOptions}
          {...(preselectOrderId ? { preselectOrderId } : {})}
        />
      )}

      <Link href="/returns" className="text-sm font-medium text-slate-500 hover:underline">
        Back to returns
      </Link>
    </PageContainer>
  );
}
