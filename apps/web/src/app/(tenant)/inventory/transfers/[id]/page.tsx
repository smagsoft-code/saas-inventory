import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../lib/auth/permissions';
import { isApiError } from '../../../../../lib/api/errors';
import { getTransfer } from '../../../../../lib/inventory/transfers';
import { buildLocationIndex, shortId } from '../../../../../lib/inventory/location-index';
import { buildUserIndex } from '../../../../../lib/core/users';
import {
  TRANSFER_STATUS_LABELS,
  transferStatusTone,
  type TransferStatus,
} from '../../../../../lib/types/inventory';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../components/ui/card';
import { Badge } from '../../../../../components/ui/badge';
import { NoAccess } from '../../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../../components/ui/table';
import { TransferDetailMobile, type MobileTransferDetail } from '../transfer-detail-mobile';
import { CreatedToast } from './created-toast';
import { TransferActions } from './transfer-actions';

export const metadata = { title: 'Transferencia · SaaS Inventory' };

/**
 * Transfer detail (`S-INV-TRANSFER-DETAIL`) — `GET /api/v1/inventory/transfers/:id`
 * (`inventory.view`). The centre of the lifecycle: approve / prepare / dispatch / receive / cancel
 * happen here through `TransferActions`. Backend is the authority for location authorization and
 * every transition — a 403/409 is shown in place, never a redirect.
 */
export default async function TransferDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const { created } = await searchParams;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Transferencia" />
        <NoAccess message="Necesitas el permiso de inventario para ver esta página." />
      </PageContainer>
    );
  }

  let transfer;
  try {
    transfer = await getTransfer(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [index, userIndex] = await Promise.all([
    buildLocationIndex(checker.can('warehouses.view')),
    buildUserIndex(checker.can('core.users.read')),
  ]);
  const status = transfer.status as TransferStatus;

  const canView = checker.can('inventory.view');
  const timeline: { label: string; value: string | undefined }[] = [
    { label: 'Creada', value: transfer.createdAt },
    { label: 'Aprobada', value: transfer.approvedAt },
    { label: 'Despachada', value: transfer.dispatchedAt },
    { label: 'Recibida', value: transfer.receivedAt },
    { label: 'Cancelada', value: transfer.cancelledAt },
    { label: 'Actualizada', value: transfer.updatedAt },
  ];

  const mobileDetail: MobileTransferDetail = {
    code: transfer.code,
    status: transfer.status,
    statusLabel: TRANSFER_STATUS_LABELS[status] ?? transfer.status,
    statusTone: transferStatusTone(transfer.status),
    source: {
      name: index.locationName(transfer.sourceLocationId),
      warehouse: index.warehouseName(transfer.sourceLocationId),
    },
    destination: {
      name: index.locationName(transfer.destinationLocationId),
      warehouse: index.warehouseName(transfer.destinationLocationId),
    },
    people: [
      { label: 'Solicitada por', value: userIndex.userName(transfer.requestedBy) },
      ...(transfer.approvedBy
        ? [{ label: 'Aprobada por', value: userIndex.userName(transfer.approvedBy) }]
        : []),
      ...(transfer.dispatchedBy
        ? [{ label: 'Despachada por', value: userIndex.userName(transfer.dispatchedBy) }]
        : []),
    ],
    notes: transfer.notes ?? undefined,
    events: timeline
      .filter((row) => row.value)
      .map((row) => ({ label: row.label, value: new Date(row.value as string).toLocaleString() })),
    items: transfer.items.map((item) => ({
      id: item.id,
      label: item.productName
        ? item.sku
          ? `${item.productName} — ${item.sku}`
          : item.productName
        : shortId(item.productVariantId),
      href: canView ? `/inventory/movements?productVariantId=${item.productVariantId}` : undefined,
      requested: item.quantityRequested,
      dispatched: item.quantityDispatched,
      received: item.quantityReceived,
      inTransit: item.quantityInTransit,
    })),
  };

  return (
    <PageContainer>
      <div className="hidden md:block">
        <PageHeader
          title={`Transferencia ${transfer.code}`}
          description={`${index.locationName(transfer.sourceLocationId)} → ${index.locationName(transfer.destinationLocationId)}`}
          actions={
            <Badge tone={transferStatusTone(transfer.status)}>
              {TRANSFER_STATUS_LABELS[status] ?? transfer.status}
            </Badge>
          }
        />
      </div>

      <CreatedToast show={created === '1'} />

      <TransferDetailMobile detail={mobileDetail} />

      <Card className="hidden md:block">
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-lg grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Origen</dt>
            <dd className="text-slate-900">
              {index.locationName(transfer.sourceLocationId)}
              <span className="text-slate-500"> · {index.warehouseName(transfer.sourceLocationId)}</span>
            </dd>
            <dt className="text-slate-500">Destino</dt>
            <dd className="text-slate-900">
              {index.locationName(transfer.destinationLocationId)}
              <span className="text-slate-500"> · {index.warehouseName(transfer.destinationLocationId)}</span>
            </dd>
            <dt className="text-slate-500">Solicitada por</dt>
            <dd className="text-slate-900">{userIndex.userName(transfer.requestedBy)}</dd>
            {transfer.approvedBy && (
              <>
                <dt className="text-slate-500">Aprobada por</dt>
                <dd className="text-slate-900">{userIndex.userName(transfer.approvedBy)}</dd>
              </>
            )}
            {transfer.dispatchedBy && (
              <>
                <dt className="text-slate-500">Despachada por</dt>
                <dd className="text-slate-900">{userIndex.userName(transfer.dispatchedBy)}</dd>
              </>
            )}
            {transfer.notes && (
              <>
                <dt className="text-slate-500">Notas</dt>
                <dd className="whitespace-pre-wrap text-slate-900">{transfer.notes}</dd>
              </>
            )}
            {timeline
              .filter((row) => row.value)
              .map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd className="text-slate-900">{new Date(row.value as string).toLocaleString()}</dd>
                </div>
              ))}
          </dl>
        </CardBody>
      </Card>

      <Card className="hidden md:block">
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Productos</h2>
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH className="text-right">Solicitado</TH>
                <TH className="text-right">Despachado</TH>
                <TH className="text-right">Recibido</TH>
                <TH className="text-right">En tránsito</TH>
              </TR>
            </THead>
            <TBody>
              {transfer.items.map((item) => {
                const label = item.productName ? (item.sku ? `${item.productName} — ${item.sku}` : item.productName) : shortId(item.productVariantId);
                return (
                <TR key={item.id}>
                  <TD>
                    {canView ? (
                      <Link
                        href={`/inventory/movements?productVariantId=${item.productVariantId}`}
                        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="text-sm text-slate-500">{label}</span>
                    )}
                  </TD>
                  <TD className="text-right text-slate-500">{item.quantityRequested}</TD>
                  <TD className="text-right text-slate-500">{item.quantityDispatched}</TD>
                  <TD className="text-right text-slate-500">{item.quantityReceived}</TD>
                  <TD className="text-right text-slate-500">{item.quantityInTransit}</TD>
                </TR>
                );
              })}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <TransferActions
        transferId={transfer.id}
        status={transfer.status}
        items={transfer.items.map((item) => ({
          id: item.id,
          productVariantId: item.productVariantId,
          ...(item.productName ? { productName: item.productName } : {}),
          ...(item.sku ? { sku: item.sku } : {}),
          quantityRequested: item.quantityRequested,
          quantityDispatched: item.quantityDispatched,
          quantityReceived: item.quantityReceived,
        }))}
        canApprove={checker.can('inventory.transfers.approve')}
        canDispatch={checker.can('inventory.transfers.dispatch')}
        canReceive={checker.can('inventory.transfers.receive')}
      />

      <Link href="/inventory/transfers" className="text-sm font-medium text-slate-500 hover:underline">
        Volver a transferencias
      </Link>
    </PageContainer>
  );
}
