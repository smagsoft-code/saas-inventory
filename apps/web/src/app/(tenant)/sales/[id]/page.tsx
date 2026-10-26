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
import { OrderDetailMobile, type MobileOrderDetail } from './order-detail-mobile';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { ButtonLink } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Alert } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { PrintButton } from '../../../../components/ui/print-button';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

export const metadata = { title: 'Pedido · SaaS Inventory' };

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
        <PageHeader title="Pedido" />
        <NoAccess message="Necesitas el permiso de pedidos para ver esta página." />
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

  // The most recent `price_approvals` row per line (by `requestedAt`) — a line can have several
  // historical rows (a rejected request reopens the form for a new one), so "latest" is what
  // `OrderActions` needs, never mere existence.
  const latestApprovalByItem = new Map<string, (typeof approvals)[number]>();
  for (const approval of approvals) {
    const current = latestApprovalByItem.get(approval.orderItemId);
    if (!current || new Date(approval.requestedAt) > new Date(current.requestedAt)) {
      latestApprovalByItem.set(approval.orderItemId, approval);
    }
  }
  const hasExceptional = order.items.some((item) => item.isExceptionalDiscount);
  const exceptionalLines: ExceptionalLine[] = order.items
    .filter((item) => item.isExceptionalDiscount)
    .map((item) => {
      const base = {
        orderItemId: item.id,
        sku: item.sku,
        productName: item.productName,
        unitPrice: item.unitPrice,
        maxPrice: item.maxPrice,
      };
      const latest = latestApprovalByItem.get(item.id);
      return latest
        ? { ...base, latestStatus: latest.status as NonNullable<ExceptionalLine['latestStatus']> }
        : base;
    });
  const pendingApprovalCount = approvals.filter((a) => a.status === 'pending').length;
  const addressEntries = Object.entries(
    (order.customer.address ?? {}) as Record<string, unknown>,
  ).filter(([, v]) => typeof v === 'string' && v !== '');

  const statusLabel = ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status;
  const subtitle = `${DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType} · ${index.locationName(order.locationId)}`;
  const reservationNotice =
    order.status === 'pending'
      ? `Este pedido tiene una reserva de stock. Confirmarlo cierra la venta; cancelarlo libera la reserva.${
          hasExceptional
            ? pendingApprovalCount > 0
              ? ' Una línea bajo el precio mínimo tiene una solicitud de aprobación de precio aún pendiente — el pedido no puede confirmarse hasta que se apruebe.'
              : ' Tiene una línea bajo el precio mínimo que necesita una aprobación de precio antes de poder confirmarse.'
            : ''
        }`
      : undefined;
  const mobileDetail: MobileOrderDetail = {
    notice: reservationNotice,
    orderNumber: order.orderNumber,
    statusLabel,
    statusTone: orderStatusTone(order.status),
    subtitle,
    customer: {
      name: order.customer.name,
      href: order.customerId && canViewCustomer ? `/customers/${order.customerId}` : undefined,
      taxId: order.customer.taxId ?? undefined,
      email: order.customer.email ?? undefined,
      phone: order.customer.phone ?? undefined,
      address:
        addressEntries.length > 0 ? addressEntries.map(([, v]) => String(v)).join(', ') : undefined,
      location: index.locationName(order.locationId),
      warehouse: index.warehouseName(order.locationId),
      invoiceStatus: order.invoiceStatus ?? undefined,
      createdLabel: new Date(order.createdAt).toLocaleString('es'),
    },
    items: order.items.map((item) => ({
      id: item.id,
      sku: item.sku,
      productName: item.productName,
      belowMinimum: item.isExceptionalDiscount,
      movementsHref: canViewInventory
        ? `/inventory/movements?productVariantId=${item.productVariantId}`
        : undefined,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
    })),
    totals: {
      subtotal: order.subtotal.toFixed(2),
      discount: order.discountTotal.toFixed(2),
      tax: order.taxTotal.toFixed(2),
      total: order.total.toFixed(2),
      currency: order.currency,
    },
  };

  return (
    <PageContainer>
      <div className="hidden md:block">
        <PageHeader
          title={`Pedido ${order.orderNumber}`}
          description={`${DOCUMENT_TYPE_LABELS[order.documentType as DocumentType] ?? order.documentType} · ${index.locationName(order.locationId)}`}
          actions={
            <div className="flex items-center gap-2">
              {order.status === 'confirmed' && canCreateReturn && (
                <ButtonLink
                  href={`/returns/new?orderId=${order.id}`}
                  size="sm"
                  variant="secondary"
                  className="print:hidden"
                >
                  Iniciar devolución
                </ButtonLink>
              )}
              <PrintButton className="print:hidden" />
              <Badge tone={orderStatusTone(order.status)}>
                {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
              </Badge>
            </div>
          }
        />
      </div>

      {reservationNotice && (
        <div className="hidden md:block">
          <Alert tone={hasExceptional && pendingApprovalCount > 0 ? 'warning' : 'info'}>
            {reservationNotice}
          </Alert>
        </div>
      )}

      <OrderDetailMobile
        detail={mobileDetail}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {order.status === 'confirmed' && canCreateReturn && (
              <ButtonLink href={`/returns/new?orderId=${order.id}`} size="sm" variant="secondary">
                Iniciar devolución
              </ButtonLink>
            )}
            <PrintButton />
          </div>
        }
      />

      <Card className="hidden md:block">
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-lg grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Cliente</dt>
            <dd className="text-slate-900">
              {order.customerId && canViewCustomer ? (
                <Link
                  href={`/customers/${order.customerId}`}
                  className="font-medium underline underline-offset-2"
                >
                  {order.customer.name}
                </Link>
              ) : (
                order.customer.name
              )}
            </dd>
            {order.customer.taxId && (
              <>
                <dt className="text-slate-500">Identificación</dt>
                <dd className="text-slate-900">{order.customer.taxId}</dd>
              </>
            )}
            {order.customer.email && (
              <>
                <dt className="text-slate-500">Correo</dt>
                <dd className="text-slate-900">{order.customer.email}</dd>
              </>
            )}
            {order.customer.phone && (
              <>
                <dt className="text-slate-500">Teléfono</dt>
                <dd className="text-slate-900">{order.customer.phone}</dd>
              </>
            )}
            {addressEntries.length > 0 && (
              <>
                <dt className="text-slate-500">Dirección</dt>
                <dd className="text-slate-900">
                  {addressEntries.map(([, v]) => String(v)).join(', ')}
                </dd>
              </>
            )}
            <dt className="text-slate-500">Almacén</dt>
            <dd className="text-slate-900">
              {index.locationName(order.locationId)}
              <span className="text-slate-500"> · {index.warehouseName(order.locationId)}</span>
            </dd>
            {order.invoiceStatus && (
              <>
                <dt className="text-slate-500">Estado de la factura</dt>
                <dd className="text-slate-900">{order.invoiceStatus}</dd>
              </>
            )}
            <dt className="text-slate-500">Realizado</dt>
            <dd className="text-slate-900">{new Date(order.createdAt).toLocaleString('es')}</dd>
          </dl>
        </CardBody>
      </Card>

      <Card className="hidden md:block">
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Líneas</h2>
          <Table>
            <THead>
              <TR>
                <TH>Artículo</TH>
                <TH className="text-right">Cant.</TH>
                <TH className="text-right">Precio unitario</TH>
                <TH className="text-right">Total de línea</TH>
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
                        bajo el mínimo
                      </Badge>
                    )}
                    {canViewInventory && (
                      <div>
                        <Link
                          href={`/inventory/movements?productVariantId=${item.productVariantId}`}
                          className="text-xs text-slate-500 underline-offset-2 hover:underline"
                        >
                          movimientos
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
            <dt className="text-slate-500">Descuento (informativo)</dt>
            <dd className="text-right text-slate-500">{order.discountTotal.toFixed(2)}</dd>
            <dt className="text-slate-500">Impuesto</dt>
            <dd className="text-right text-slate-500">{order.taxTotal.toFixed(2)}</dd>
            <dt className="font-medium text-slate-900">Total</dt>
            <dd className="text-right font-semibold text-slate-900">
              {order.total.toFixed(2)} {order.currency}
            </dd>
          </dl>
        </CardBody>
      </Card>

      <div className="print:hidden">
        <OrderActions
          orderId={order.id}
          status={order.status}
          total={order.total}
          canConfirm={canConfirm}
          canCancel={canCancel}
          canRequestApproval={canRequestApproval}
          exceptionalLines={exceptionalLines}
          requesterName={session?.fullName ?? ''}
        />
      </div>

      {canViewApprovals && approvals.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Aprobaciones de precio</h2>
            <Table>
              <THead>
                <TR>
                  <TH>Línea</TH>
                  <TH className="text-right">Precio solicitado</TH>
                  <TH>Estado</TH>
                  <TH className="w-0">
                    <span className="sr-only">Acciones</span>
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
                          <code className="text-xs text-slate-500">
                            {shortId(approval.orderItemId)}
                          </code>
                        )}
                      </TD>
                      <TD className="text-right text-slate-500">
                        {approval.requestedPrice.toFixed(2)}
                      </TD>
                      <TD>
                        <Badge tone={priceApprovalStatusTone(approval.status)}>
                          {PRICE_APPROVAL_STATUS_LABELS[approval.status as PriceApprovalStatus] ??
                            approval.status}
                        </Badge>
                      </TD>
                      <TD>
                        <Link
                          href={`/approvals/${approval.id}`}
                          className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                        >
                          Ver
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
              <h2 className="text-sm font-semibold text-slate-900">Notificación</h2>
              <Badge tone={notificationOverallTone(notifications.overallStatus)}>
                {NOTIFICATION_OVERALL_LABELS[
                  notifications.overallStatus as NotificationOverallStatus
                ] ?? notifications.overallStatus}
              </Badge>
            </div>
            {notifications.events.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aún no se ha generado ninguna notificación para este pedido. Confirmarlo o
                cancelarlo pondrá una en cola.
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
                    {event.attempts > 0 && (
                      <span className="text-slate-400">· {event.attempts} intentos</span>
                    )}
                    <span className="text-slate-400">
                      · {new Date(event.occurredAt).toLocaleString('es')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {notifications.overallStatus === 'failed' && (
              <p className="text-xs text-slate-500">
                Reenviar una notificación fallida aún no está disponible — necesita un contrato de
                backend (`GAP-NOTIF-RETRY-BACKEND`).
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {canViewReturns && returns.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Devoluciones</h2>
            <Table>
              <THead>
                <TR>
                  <TH>Devolución</TH>
                  <TH>Producto</TH>
                  <TH>Motivo</TH>
                  <TH>Estado</TH>
                  <TH className="w-0">
                    <span className="sr-only">Acciones</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {returns.map((ret) => (
                  <TR key={ret.id}>
                    <TD>
                      <span className="text-sm font-medium text-slate-900">{ret.returnNumber}</span>
                    </TD>
                    <TD className="text-slate-700">
                      {ret.items.map((item) => (
                        <p key={item.id}>
                          {item.productName ?? item.sku ?? shortId(item.productVariantId)}
                          {item.quantityReturned > 1 && (
                            <span className="text-slate-500"> × {item.quantityReturned}</span>
                          )}
                        </p>
                      ))}
                    </TD>
                    <TD className="max-w-xs text-slate-600">{ret.reason}</TD>
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
                        Ver
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <div className="flex gap-4 text-sm print:hidden">
        <Link href="/sales" className="font-medium text-slate-500 hover:underline">
          Historial de ventas
        </Link>
        {canViewReturns && (
          <Link
            href={`/returns?orderId=${order.id}`}
            className="font-medium text-slate-500 hover:underline"
          >
            Devoluciones
          </Link>
        )}
        <Link href="/sales/new" className="font-medium text-slate-500 hover:underline">
          Nueva venta
        </Link>
        {order.customerId && canViewCustomer && (
          <Link
            href={`/customers/${order.customerId}`}
            className="font-medium text-slate-500 hover:underline"
          >
            Ver cliente
          </Link>
        )}
      </div>
    </PageContainer>
  );
}
