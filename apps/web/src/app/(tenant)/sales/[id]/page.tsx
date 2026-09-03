import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getOrder, getOrderNotifications } from '../../../../lib/sales/orders';
import { listPriceApprovals } from '../../../../lib/sales/price-approvals';
import { listReturns } from '../../../../lib/sales/returns';
import { buildLocationIndex, shortId } from '../../../../lib/inventory/location-index';
import {
  DOCUMENT_TYPE_LABELS,
  NOTIFICATION_EVENT_TYPE_LABELS,
  NOTIFICATION_OVERALL_LABELS,
  ORDER_STATUS_LABELS,
  PRICE_APPROVAL_STATUS_LABELS,
  RETURN_STATUS_LABELS,
  notificationOverallTone,
  orderStatusTone,
  priceApprovalStatusTone,
  returnStatusTone,
  type DocumentType,
  type NotificationOverallStatus,
  type OrderStatus,
  type PriceApprovalStatus,
  type ReturnStatus,
} from '../../../../lib/types/sales';
import { OrderActions, type ExceptionalLine } from './order-actions';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { ButtonLink } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Alert } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

export const metadata = { title: 'Order · SaaS Inventory' };

/**
 * Order detail (`S-ORDER-DETAIL`) — `GET /api/v1/orders/:id` (`sales.orders.view`). It is the
 * checkout landing and the Customer → Order target. F17-09 adds the lifecycle: `confirm` / `cancel`
 * (`OrderActions`, backend-authorized) and, for a caller who can see the approval queue, the
 * order's `price_approvals` rows (`GET /price-approvals?orderId=`) with a request flow for
 * below-minimum lines.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.orders.view')) {
    return (
      <PageContainer>
        <PageHeader title="Order" />
        <NoAccess message="You need the orders permission to view this page." />
      </PageContainer>
    );
  }
  const canViewInventory = checker.can('inventory.view');
  const canViewCustomer = checker.can('sales.customers.view');
  const canConfirm = checker.can('sales.orders.create');
  const canCancel = checker.can('sales.orders.cancel');
  const canRequestApproval = checker.can('pricing.discount.request');
  const canViewApprovals = checker.canAny(['pricing.discount.request', 'pricing.discount.approve']);
  const canViewReturns = checker.can('sales.returns.view');
  const canCreateReturn = checker.can('sales.returns.create');

  let order;
  try {
    order = await getOrder(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [index, approvals, notifications, returns] = await Promise.all([
    buildLocationIndex(checker.can('warehouses.view')),
    canViewApprovals
      ? listPriceApprovals({ orderId: id, pageSize: 100 })
          .then((r) => r.data)
          .catch(() => [])
      : Promise.resolve([]),
    getOrderNotifications(id).catch(() => null),
    canViewReturns
      ? listReturns({ orderId: id, pageSize: 100 })
          .then((r) => r.data)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const approvalByItem = new Map(approvals.map((a) => [a.orderItemId, a]));
  const hasExceptional = order.items.some((item) => item.isExceptionalDiscount);
  const exceptionalLines: ExceptionalLine[] = order.items
    .filter((item) => item.isExceptionalDiscount)
    .map((item) => ({
      orderItemId: item.id,
      sku: item.sku,
      productName: item.productName,
      hasApproval: approvalByItem.has(item.id),
    }));
  const pendingApprovalCount = approvals.filter((a) => a.status === 'pending').length;
  const addressEntries = Object.entries((order.customer.address ?? {}) as Record<string, unknown>).filter(
    ([, v]) => typeof v === 'string' && v !== '',
  );

  return (
    <PageContainer>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description={`${DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType} · ${index.locationName(order.locationId)}`}
        actions={
          <div className="flex items-center gap-2">
            {order.status === 'confirmed' && canCreateReturn && (
              <ButtonLink href={`/returns/new?orderId=${order.id}`} size="sm" variant="secondary">
                Start a return
              </ButtonLink>
            )}
            <Badge tone={orderStatusTone(order.status)}>
              {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
            </Badge>
          </div>
        }
      />

      {order.status === 'pending' && (
        <Alert tone={hasExceptional && pendingApprovalCount > 0 ? 'warning' : 'info'}>
          This order holds a stock reservation. Confirming it commits the sale; cancelling releases
          the reservation.
          {hasExceptional &&
            (pendingApprovalCount > 0
              ? ' A below-minimum line has a price-approval request still pending — the order cannot be confirmed until it is approved.'
              : ' It has a below-minimum line that needs an approved price approval before it can be confirmed.')}
        </Alert>
      )}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-lg grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Customer</dt>
            <dd className="text-slate-900">
              {order.customerId && canViewCustomer ? (
                <Link href={`/customers/${order.customerId}`} className="font-medium underline underline-offset-2">
                  {order.customer.name}
                </Link>
              ) : (
                order.customer.name
              )}
            </dd>
            {order.customer.taxId && (
              <>
                <dt className="text-slate-500">Tax id</dt>
                <dd className="text-slate-900">{order.customer.taxId}</dd>
              </>
            )}
            {order.customer.email && (
              <>
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-900">{order.customer.email}</dd>
              </>
            )}
            {order.customer.phone && (
              <>
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-900">{order.customer.phone}</dd>
              </>
            )}
            {addressEntries.length > 0 && (
              <>
                <dt className="text-slate-500">Address</dt>
                <dd className="text-slate-900">{addressEntries.map(([, v]) => String(v)).join(', ')}</dd>
              </>
            )}
            <dt className="text-slate-500">Location</dt>
            <dd className="text-slate-900">
              {index.locationName(order.locationId)}
              <span className="text-slate-500"> · {index.warehouseName(order.locationId)}</span>
            </dd>
            {order.invoiceStatus && (
              <>
                <dt className="text-slate-500">Invoice status</dt>
                <dd className="text-slate-900">{order.invoiceStatus}</dd>
              </>
            )}
            <dt className="text-slate-500">Placed</dt>
            <dd className="text-slate-900">{new Date(order.createdAt).toLocaleString()}</dd>
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
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Unit price</TH>
                <TH className="text-right">Line total</TH>
              </TR>
            </THead>
            <TBody>
              {order.items.map((item) => (
                <TR key={item.id}>
                  <TD>
                    <span className="font-medium">{item.sku}</span>
                    <span className="text-slate-500"> · {item.productName}</span>
                    {item.isExceptionalDiscount && (
                      <Badge tone="warning" className="ml-2">
                        below min
                      </Badge>
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
                  <TD className="text-right text-slate-500">{item.quantity}</TD>
                  <TD className="text-right text-slate-500">{item.unitPrice.toFixed(2)}</TD>
                  <TD className="text-right text-slate-900">{item.lineTotal.toFixed(2)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <dl className="ml-auto grid w-64 grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">Subtotal</dt>
            <dd className="text-right text-slate-900">{order.subtotal.toFixed(2)}</dd>
            <dt className="text-slate-500">Discount (informational)</dt>
            <dd className="text-right text-slate-500">{order.discountTotal.toFixed(2)}</dd>
            <dt className="text-slate-500">Tax</dt>
            <dd className="text-right text-slate-500">{order.taxTotal.toFixed(2)}</dd>
            <dt className="font-medium text-slate-900">Total</dt>
            <dd className="text-right font-semibold text-slate-900">
              {order.total.toFixed(2)} {order.currency}
            </dd>
          </dl>
        </CardBody>
      </Card>

      <OrderActions
        orderId={order.id}
        status={order.status}
        canConfirm={canConfirm}
        canCancel={canCancel}
        canRequestApproval={canRequestApproval}
        exceptionalLines={exceptionalLines}
      />

      {canViewApprovals && approvals.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Price approvals</h2>
            <Table>
              <THead>
                <TR>
                  <TH>Line</TH>
                  <TH className="text-right">Requested price</TH>
                  <TH>Status</TH>
                  <TH className="w-0">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {approvals.map((approval) => {
                  const line = order.items.find((item) => item.id === approval.orderItemId);
                  return (
                    <TR key={approval.id}>
                      <TD>
                        {line ? (
                          <>
                            <span className="font-medium">{line.sku}</span>
                            <span className="text-slate-500"> · {line.productName}</span>
                          </>
                        ) : (
                          <code className="text-xs text-slate-500">{shortId(approval.orderItemId)}</code>
                        )}
                      </TD>
                      <TD className="text-right text-slate-500">{approval.requestedPrice.toFixed(2)}</TD>
                      <TD>
                        <Badge tone={priceApprovalStatusTone(approval.status)}>
                          {PRICE_APPROVAL_STATUS_LABELS[approval.status as PriceApprovalStatus] ?? approval.status}
                        </Badge>
                      </TD>
                      <TD>
                        <Link
                          href={`/approvals/${approval.id}`}
                          className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                        >
                          View
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {notifications && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Notification</h2>
              <Badge tone={notificationOverallTone(notifications.overallStatus)}>
                {NOTIFICATION_OVERALL_LABELS[notifications.overallStatus as NotificationOverallStatus] ??
                  notifications.overallStatus}
              </Badge>
            </div>
            {notifications.events.length === 0 ? (
              <p className="text-sm text-slate-500">
                No notification has been raised for this order yet. Confirming or cancelling an order queues one.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {notifications.events.map((event) => (
                  <li key={event.eventId} className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-700">
                      {NOTIFICATION_EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">{event.status}</span>
                    {event.attempts > 0 && <span className="text-slate-400">· {event.attempts} attempts</span>}
                    <span className="text-slate-400">· {new Date(event.occurredAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
            {notifications.overallStatus === 'failed' && (
              <p className="text-xs text-slate-500">
                Re-sending a failed notification is not available yet — it needs a backend contract
                (`GAP-NOTIF-RETRY-BACKEND`).
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {canViewReturns && returns.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Returns</h2>
            <Table>
              <THead>
                <TR>
                  <TH>Return</TH>
                  <TH className="text-right">Lines</TH>
                  <TH>Status</TH>
                  <TH className="w-0">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {returns.map((ret) => (
                  <TR key={ret.id}>
                    <TD>
                      <code className="text-xs text-slate-500">{shortId(ret.id)}</code>
                    </TD>
                    <TD className="text-right text-slate-500">{ret.items.length}</TD>
                    <TD>
                      <Badge tone={returnStatusTone(ret.status)}>
                        {RETURN_STATUS_LABELS[ret.status as ReturnStatus] ?? ret.status}
                      </Badge>
                    </TD>
                    <TD>
                      <Link
                        href={`/returns/${ret.id}`}
                        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                      >
                        View
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <div className="flex gap-4 text-sm">
        <Link href="/sales" className="font-medium text-slate-500 hover:underline">
          Sales history
        </Link>
        {canViewReturns && (
          <Link href={`/returns?orderId=${order.id}`} className="font-medium text-slate-500 hover:underline">
            Returns
          </Link>
        )}
        <Link href="/sales/new" className="font-medium text-slate-500 hover:underline">
          New sale
        </Link>
        {order.customerId && canViewCustomer && (
          <Link href={`/customers/${order.customerId}`} className="font-medium text-slate-500 hover:underline">
            Customer {shortId(order.customerId)}
          </Link>
        )}
      </div>
    </PageContainer>
  );
}
