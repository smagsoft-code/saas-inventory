import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getReturn } from '../../../../lib/sales/returns';
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

export const metadata = { title: 'Devolución · SaaS Inventory' };

/**
 * Sales return detail (`S-RET-DETAIL`) — `GET /api/v1/sales-returns/:id` (`sales.returns.view`).
 * Actions: `inspect` / `resolve` (`inventory.returns.manage` + location authorization) and `cancel`
 * (`sales.returns.create`) via `ReturnActions`, all backend-authorized. Lines carry only
 * the frozen `sku`/`productName` of the sold line; the API also resolves the return number (DEV-001),
 * the order number and the requester/receiver names.
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
        <PageHeader title="Devolución" />
        <NoAccess message="Necesitas el permiso de devoluciones para ver esta página." />
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

  const index = await buildLocationIndex(checker.can('warehouses.view'));

  const activeLocations = index.locations.filter((location) => location.status === 'active');
  const sellableLocations = activeLocations.filter((location) => location.isSellable).map((l) => ({ id: l.id, name: l.name }));
  const nonSellableLocations = activeLocations.filter((location) => !location.isSellable).map((l) => ({ id: l.id, name: l.name }));

  const actionLines: ActionLine[] = ret.items.map((item) => {
    return {
      returnItemId: item.id,
      label: item.productName ? `${item.sku ?? ''}${item.sku ? ' · ' : ''}${item.productName}` : shortId(item.productVariantId),
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
        title={`Devolución ${ret.returnNumber}`}
        description={`Recibido en ${index.locationName(ret.locationId)}`}
        actions={
          <Badge tone={returnStatusTone(ret.status)}>
            {RETURN_STATUS_LABELS[ret.status as ReturnStatus] ?? ret.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-lg grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Pedido</dt>
            <dd className="text-slate-900">
              {canViewOrders ? (
                <Link href={`/sales/${ret.orderId}`} className="font-medium underline underline-offset-2">
                  {ret.orderNumber ?? shortId(ret.orderId)}
                </Link>
              ) : (
                <span>{ret.orderNumber ?? shortId(ret.orderId)}</span>
              )}
            </dd>
            <dt className="text-slate-500">Almacén de recepción</dt>
            <dd className="text-slate-900">
              {index.locationName(ret.locationId)}
              <span className="text-slate-500"> · {index.warehouseName(ret.locationId)}</span>
            </dd>
            <dt className="text-slate-500">Solicitado por</dt>
            <dd className="text-slate-900">{ret.requestedByName ?? <code className="text-xs">{shortId(ret.requestedBy)}</code>}</dd>
            {ret.receivedBy && (
              <>
                <dt className="text-slate-500">Recibido por</dt>
                <dd className="text-slate-900">
                  {ret.receivedByName ?? <code className="text-xs">{shortId(ret.receivedBy)}</code>}
                </dd>
              </>
            )}
            <dt className="text-slate-500">Motivo</dt>
            <dd className="whitespace-pre-wrap text-slate-900">{ret.reason}</dd>
            <dt className="text-slate-500">Creado</dt>
            <dd className="text-slate-900">{new Date(ret.createdAt).toLocaleString('es')}</dd>
            <dt className="text-slate-500">Actualizado</dt>
            <dd className="text-slate-900">{new Date(ret.updatedAt).toLocaleString('es')}</dd>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Líneas</h2>
          <Table>
            <THead>
              <TR>
                <TH>Artículo</TH>
                <TH className="text-right">Cant. devuelta</TH>
                <TH>Disposición</TH>
                <TH>Almacén de disposición</TH>
                <TH>Notas</TH>
              </TR>
            </THead>
            <TBody>
              {ret.items.map((item) => {
                return (
                  <TR key={item.id}>
                    <TD>
                      {item.productName ? (
                        <>
                          <span className="font-medium">{item.sku}</span>
                          <span className="text-slate-500"> · {item.productName}</span>
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
                            movimientos
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
          Todas las devoluciones
        </Link>
        {canViewOrders && (
          <Link href={`/sales/${ret.orderId}`} className="font-medium text-slate-500 hover:underline">
            Pedido {ret.orderNumber ?? shortId(ret.orderId)}
          </Link>
        )}
      </div>
    </PageContainer>
  );
}
