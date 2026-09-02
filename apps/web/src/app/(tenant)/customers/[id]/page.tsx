import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getCustomer } from '../../../../lib/sales/customers';
import { listOrders } from '../../../../lib/sales/orders';
import {
  CUSTOMER_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  customerMissingCommercialData,
  orderStatusTone,
  type CustomerType,
  type OrderStatus,
} from '../../../../lib/types/sales';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Alert } from '../../../../components/ui/alert';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { ButtonLink } from '../../../../components/ui/button';
import { NoAccess } from '../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import { CustomerForm } from '../customer-form';

export const metadata = { title: 'Customer · SaaS Inventory' };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.customers.view')) {
    return (
      <PageContainer>
        <PageHeader title="Customer" />
        <NoAccess message="You need the customers permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('sales.customers.manage');
  const canViewOrders = checker.can('sales.orders.view');
  const canSell = checker.can('sales.orders.create');

  let customer;
  try {
    customer = await getCustomer(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const orders = canViewOrders
    ? await listOrders({ customerId: id, pageSize: 20 }).catch(() => null)
    : null;

  const missing = customerMissingCommercialData(customer);
  const addressEntries = Object.entries((customer.address ?? {}) as Record<string, unknown>).filter(
    ([, v]) => typeof v === 'string' && v !== '',
  );

  return (
    <PageContainer>
      <PageHeader
        title={customer.displayName}
        description={CUSTOMER_TYPE_LABELS[customer.type as CustomerType] ?? customer.type}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(customer.status)}>{customer.status}</Badge>
            {canSell && <ButtonLink href={`/sales/new?customerId=${customer.id}`} size="sm">Start a sale</ButtonLink>}
          </div>
        }
      />

      {missing.length > 0 && (
        <Alert tone="warning">
          This customer is missing {missing.join(', ')}. A sale cannot be completed until these are filled in.
        </Alert>
      )}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Details</h2>
          {canManage ? (
            <CustomerForm mode="edit" customer={customer} />
          ) : (
            <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Tax id</dt>
              <dd className="text-slate-900">{customer.taxId ?? '—'}</dd>
              <dt className="text-slate-500">Email</dt>
              <dd className="text-slate-900">{customer.email ?? '—'}</dd>
              <dt className="text-slate-500">Phone</dt>
              <dd className="text-slate-900">{customer.phone ?? '—'}</dd>
              <dt className="text-slate-500">Address</dt>
              <dd className="text-slate-900">
                {addressEntries.length > 0 ? addressEntries.map(([, v]) => String(v)).join(', ') : '—'}
              </dd>
              {customer.notes && (
                <>
                  <dt className="text-slate-500">Notes</dt>
                  <dd className="whitespace-pre-wrap text-slate-900">{customer.notes}</dd>
                </>
              )}
            </dl>
          )}
        </CardBody>
      </Card>

      {canViewOrders && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Orders</h2>
            {!orders || orders.data.length === 0 ? (
              <p className="text-sm text-slate-500">This customer has no orders.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Order</TH>
                    <TH>Status</TH>
                    <TH>Document</TH>
                    <TH className="text-right">Total</TH>
                    <TH>Created</TH>
                    <TH className="w-0">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {orders.data.map((order) => (
                    <TR key={order.id}>
                      <TD className="font-medium">{order.orderNumber}</TD>
                      <TD>
                        <Badge tone={orderStatusTone(order.status)}>
                          {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                        </Badge>
                      </TD>
                      <TD className="text-slate-500">{order.documentType}</TD>
                      <TD className="text-right text-slate-500">
                        {order.total.toFixed(2)} {order.currency}
                      </TD>
                      <TD className="whitespace-nowrap text-slate-500">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </TD>
                      <TD>
                        <Link
                          href={`/sales/${order.id}`}
                          className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                        >
                          View
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      <Link href="/customers" className="text-sm font-medium text-slate-500 hover:underline">
        Back to customers
      </Link>
    </PageContainer>
  );
}
