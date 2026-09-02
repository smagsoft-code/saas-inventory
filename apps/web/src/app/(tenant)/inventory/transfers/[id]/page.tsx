import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../lib/auth/permissions';
import { isApiError } from '../../../../../lib/api/errors';
import { getTransfer } from '../../../../../lib/inventory/transfers';
import { buildLocationIndex, shortId } from '../../../../../lib/inventory/location-index';
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
import { TransferActions } from './transfer-actions';

export const metadata = { title: 'Transfer · SaaS Inventory' };

/**
 * Transfer detail (`S-INV-TRANSFER-DETAIL`) — `GET /api/v1/inventory/transfers/:id`
 * (`inventory.view`). The centre of the lifecycle: approve / prepare / dispatch / receive / cancel
 * happen here through `TransferActions`. Backend is the authority for location authorization and
 * every transition — a 403/409 is shown in place, never a redirect.
 */
export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Transfer" />
        <NoAccess message="You need the inventory permission to view this page." />
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

  const index = await buildLocationIndex(checker.can('warehouses.view'));
  const status = transfer.status as TransferStatus;

  const canView = checker.can('inventory.view');
  const timeline: { label: string; value: string | undefined }[] = [
    { label: 'Created', value: transfer.createdAt },
    { label: 'Approved', value: transfer.approvedAt },
    { label: 'Dispatched', value: transfer.dispatchedAt },
    { label: 'Received', value: transfer.receivedAt },
    { label: 'Cancelled', value: transfer.cancelledAt },
    { label: 'Updated', value: transfer.updatedAt },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={`Transfer ${shortId(transfer.id)}`}
        description={`${index.locationName(transfer.sourceLocationId)} → ${index.locationName(transfer.destinationLocationId)}`}
        actions={
          <Badge tone={transferStatusTone(transfer.status)}>
            {TRANSFER_STATUS_LABELS[status] ?? transfer.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-lg grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">From</dt>
            <dd className="text-slate-900">
              {index.locationName(transfer.sourceLocationId)}
              <span className="text-slate-500"> · {index.warehouseName(transfer.sourceLocationId)}</span>
            </dd>
            <dt className="text-slate-500">To</dt>
            <dd className="text-slate-900">
              {index.locationName(transfer.destinationLocationId)}
              <span className="text-slate-500"> · {index.warehouseName(transfer.destinationLocationId)}</span>
            </dd>
            <dt className="text-slate-500">Requested by</dt>
            <dd className="text-slate-900">
              <code className="text-xs">{shortId(transfer.requestedBy)}</code>
            </dd>
            {transfer.approvedBy && (
              <>
                <dt className="text-slate-500">Approved by</dt>
                <dd className="text-slate-900">
                  <code className="text-xs">{shortId(transfer.approvedBy)}</code>
                </dd>
              </>
            )}
            {transfer.dispatchedBy && (
              <>
                <dt className="text-slate-500">Dispatched by</dt>
                <dd className="text-slate-900">
                  <code className="text-xs">{shortId(transfer.dispatchedBy)}</code>
                </dd>
              </>
            )}
            {transfer.notes && (
              <>
                <dt className="text-slate-500">Notes</dt>
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

          <div className="flex flex-wrap gap-4 text-sm">
            <Link
              href={`/inventory?locationId=${transfer.sourceLocationId}`}
              className="font-medium text-slate-700 underline underline-offset-2"
            >
              Source location stock
            </Link>
            <Link
              href={`/inventory?locationId=${transfer.destinationLocationId}`}
              className="font-medium text-slate-700 underline underline-offset-2"
            >
              Destination location stock
            </Link>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Lines</h2>
          <Table>
            <THead>
              <TR>
                <TH>Variant</TH>
                <TH className="text-right">Requested</TH>
                <TH className="text-right">Dispatched</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">In transit</TH>
              </TR>
            </THead>
            <TBody>
              {transfer.items.map((item) => (
                <TR key={item.id}>
                  <TD>
                    {canView ? (
                      <Link
                        href={`/inventory/movements?productVariantId=${item.productVariantId}`}
                        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                      >
                        <code className="text-xs">{shortId(item.productVariantId)}</code>
                      </Link>
                    ) : (
                      <code className="text-xs text-slate-500">{shortId(item.productVariantId)}</code>
                    )}
                  </TD>
                  <TD className="text-right text-slate-500">{item.quantityRequested}</TD>
                  <TD className="text-right text-slate-500">{item.quantityDispatched}</TD>
                  <TD className="text-right text-slate-500">{item.quantityReceived}</TD>
                  <TD className="text-right text-slate-500">{item.quantityInTransit}</TD>
                </TR>
              ))}
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
          quantityRequested: item.quantityRequested,
          quantityDispatched: item.quantityDispatched,
          quantityReceived: item.quantityReceived,
        }))}
        canApprove={checker.can('inventory.transfers.approve')}
        canDispatch={checker.can('inventory.transfers.dispatch')}
        canReceive={checker.can('inventory.transfers.receive')}
      />

      <Link href="/inventory/transfers" className="text-sm font-medium text-slate-500 hover:underline">
        Back to transfers
      </Link>
    </PageContainer>
  );
}
