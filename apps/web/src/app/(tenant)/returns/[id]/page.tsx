import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getReturn } from '../../../../lib/sales/returns';
import { getOrder } from '../../../../lib/sales/orders';
import { buildLocationIndex, shortId } from '../../../../lib/inventory/location-index';
import {
  DISPOSITION_LABELS,
  RETURN_STATUS_LABELS,
  returnStatusTone,
  type Disposition,
  type ReturnStatus,
} from '../../../../lib/types/sales';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import { ReturnActions, type ActionLine } from './return-actions';

export const metadata = { title: 'Return · SaaS Inventory' };

/**
 * Sales return detail (`S-RET-DETAIL`) — `GET /api/v1/sales-returns/:id` (`sales.returns.view`).
 * Actions: `inspect` / `resolve` (`inventory.returns.manage` + location authorization) and `cancel`
 * (`sales.returns.create`) via `ReturnActions`, all backend-authorized. Lines carry only
 * `orderItemId` + `productVariantId` (`GAP-NAME-ENRICHMENT`); the SKU/name are resolved from the
 * parent order when the caller holds `sales.orders.view`.
 */
export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.returns.view')) {
    return (
      <PageContainer>
        <PageHeader title="Return" />
        <NoAccess message="You need the returns permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('inventory.returns.manage');
  const canCancel = checker.can('sales.returns.create');
  const canViewOrders = checker.can('sales.orders.view');
  const canViewInventory = checker.can('inventory.view');

  let ret;
  try {
    ret = await getReturn(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [index, order] = await Promise.all([
    buildLocationIndex(checker.can('warehouses.view')),
    canViewOrders ? getOrder(ret.orderId).catch(() => null) : Promise.resolve(null),
  ]);
  const orderLineById = new Map((order?.items ?? []).map((item) => [item.id, item]));

  const activeLocations = index.locations.filter((location) => location.status === 'active');
  const sellableLocations = activeLocations.filter((location) => location.isSellable).map((l) => ({ id: l.id, name: l.name }));
  const nonSellableLocations = activeLocations.filter((location) => !location.isSellable).map((l) => ({ id: l.id, name: l.name }));

  const actionLines: ActionLine[] = ret.items.map((item) => {
    const orderLine = orderLineById.get(item.orderItemId);
    return {
      returnItemId: item.id,
      label: orderLine ? `${orderLine.sku} · ${orderLine.productName}` : shortId(item.productVariantId),
      quantityReturned: item.quantityReturned,
      inspected: Boolean(item.disposition && item.dispositionLocationId),
      ...(item.disposition ? { disposition: item.disposition as Disposition } : {}),
      ...(item.dispositionLocationId ? { dispositionLocationId: item.dispositionLocationId } : {}),
    };
  });
  const allInspected = ret.items.length > 0 && ret.items.every((item) => item.disposition && item.dispositionLocationId);

  return (
    <PageContainer>
      <PageHeader
        title={`Return ${shortId(ret.id)}`}
        description={`Received at ${index.locationName(ret.locationId)}`}
        actions={
          <Badge tone={returnStatusTone(ret.status)}>
            {RETURN_STATUS_LABELS[ret.status as ReturnStatus] ?? ret.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-lg grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Order</dt>
            <dd className="text-slate-900">
              {canViewOrders ? (
                <Link href={`/sales/${ret.orderId}`} className="font-medium underline underline-offset-2">
                  {order ? order.orderNumber : shortId(ret.orderId)}
                </Link>
              ) : (
                <code className="text-xs">{shortId(ret.orderId)}</code>
              )}
            </dd>
            <dt className="text-slate-500">Receiving location</dt>
            <dd className="text-slate-900">
              {index.locationName(ret.locationId)}
              <span className="text-slate-500"> · {index.warehouseName(ret.locationId)}</span>
            </dd>
            <dt className="text-slate-500">Requested by</dt>
            <dd className="text-slate-900">
              <code className="text-xs">{shortId(ret.requestedBy)}</code>
            </dd>
            {ret.receivedBy && (
              <>
                <dt className="text-slate-500">Received by</dt>
                <dd className="text-slate-900">
                  <code className="text-xs">{shortId(ret.receivedBy)}</code>
                </dd>
              </>
            )}
            <dt className="text-slate-500">Reason</dt>
            <dd className="whitespace-pre-wrap text-slate-900">{ret.reason}</dd>
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-900">{new Date(ret.createdAt).toLocaleString()}</dd>
            <dt className="text-slate-500">Updated</dt>
            <dd className="text-slate-900">{new Date(ret.updatedAt).toLocaleString()}</dd>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Lines</h2>
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH className="text-right">Qty returned</TH>
                <TH>Disposition</TH>
                <TH>Disposition location</TH>
                <TH>Notes</TH>
              </TR>
            </THead>
            <TBody>
              {ret.items.map((item) => {
                const orderLine = orderLineById.get(item.orderItemId);
                return (
                  <TR key={item.id}>
                    <TD>
                      {orderLine ? (
                        <>
                          <span className="font-medium">{orderLine.sku}</span>
                          <span className="text-slate-500"> · {orderLine.productName}</span>
                        </>
                      ) : (
                        <code className="text-xs text-slate-500">{shortId(item.productVariantId)}</code>
                      )}
                      {canViewInventory && (
                        <div>
                          <Link
                            href={`/inventory/movements?productVariantId=${item.productVariantId}`}
                            className="text-xs text-slate-500 underline-offset-2 hover:underline"
                          >
                            movements
                          </Link>
                        </div>
                      )}
                    </TD>
                    <TD className="text-right text-slate-500">{item.quantityReturned}</TD>
                    <TD className="text-slate-700">
                      {item.disposition
                        ? DISPOSITION_LABELS[item.disposition as Disposition] ?? item.disposition
                        : '—'}
                    </TD>
                    <TD className="text-slate-500">
                      {item.dispositionLocationId ? index.locationName(item.dispositionLocationId) : '—'}
                    </TD>
                    <TD className="text-slate-500">{item.notes || '—'}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <ReturnActions
        returnId={ret.id}
        status={ret.status}
        lines={actionLines}
        allInspected={allInspected}
        sellableLocations={sellableLocations}
        nonSellableLocations={nonSellableLocations}
        canManage={canManage}
        canCancel={canCancel}
      />

      <div className="flex gap-4 text-sm">
        <Link href="/returns" className="font-medium text-slate-500 hover:underline">
          All returns
        </Link>
        {canViewOrders && (
          <Link href={`/sales/${ret.orderId}`} className="font-medium text-slate-500 hover:underline">
            Order {order ? order.orderNumber : shortId(ret.orderId)}
          </Link>
        )}
      </div>
    </PageContainer>
  );
}
