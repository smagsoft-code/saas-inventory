import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getOrder } from '../../../../lib/sales/orders';
import { buildLocationIndex, shortId } from '../../../../lib/inventory/location-index';
import {
  DOCUMENT_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  orderStatusTone,
  type DocumentType,
  type OrderStatus,
} from '../../../../lib/types/sales';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Alert } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

export const metadata = { title: 'Order · SaaS Inventory' };

/**
 * Order detail (`S-ORDER-DETAIL`) — `GET /api/v1/orders/:id` (`sales.orders.view`). Read-only in
 * F17-08: it is the checkout landing and the Customer → Order target. The order lifecycle
 * (`POST /orders/:id/confirm` / `/cancel`, and the price-approval queue) is a later phase (F17-09).
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

  let order;
  try {
    order = await getOrder(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const index = await buildLocationIndex(checker.can('warehouses.view'));
  const hasExceptional = order.items.some((item) => item.isExceptionalDiscount);
  const addressEntries = Object.entries((order.customer.address ?? {}) as Record<string, unknown>).filter(
    ([, v]) => typeof v === 'string' && v !== '',
  );

  return (
    <PageContainer>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description={`${DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType} · ${index.locationName(order.locationId)}`}
        actions={
          <Badge tone={orderStatusTone(order.status)}>
            {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
          </Badge>
        }
      />

      {order.status === 'pending' && (
        <Alert tone="info">
          This order holds a stock reservation. Confirming it (which commits the sale) is done from
          the order lifecycle screen — not available yet.
          {hasExceptional && ' It also has a below-minimum price that needs an approval before it can be confirmed.'}
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

      <div className="flex gap-4 text-sm">
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
