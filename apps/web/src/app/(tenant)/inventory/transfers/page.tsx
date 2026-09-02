import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listTransfers } from '../../../../lib/inventory/transfers';
import { buildLocationIndex, shortId } from '../../../../lib/inventory/location-index';
import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_LABELS,
  transferStatusTone,
  type Transfer,
  type TransferStatus,
} from '../../../../lib/types/inventory';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { ButtonLink } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { NoAccess } from '../../../../components/ui/no-access';
import { Pagination } from '../../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

export const metadata = { title: 'Transfers · SaaS Inventory' };

const PAGE_SIZE = 20;

function parseStatus(value: string | undefined): TransferStatus | undefined {
  return (TRANSFER_STATUSES as readonly string[]).includes(value ?? '') ? (value as TransferStatus) : undefined;
}

/**
 * Transfers list (`S-INV-TRANSFERS`) — `GET /api/v1/inventory/transfers` (`inventory.view`), offset
 * paginated. Real filters only: a single `status` (`GAP-MULTI-STATUS`), `sourceLocationId`,
 * `destinationLocationId` — no search, no sort, no date range. The endpoint returns FK ids only;
 * location/warehouse names come from one bounded `buildLocationIndex()` fetch, the transfer id is
 * shown as a short code (`GAP-TRANSFER-CODE`), the variant ids are not named here (`GAP-VARIANT-LIST`).
 */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; sourceLocationId?: string; destinationLocationId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Transfers" />
        <NoAccess message="You need the inventory permission to view this page." />
      </PageContainer>
    );
  }
  const canRequest = checker.can('inventory.transfers.request');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = parseStatus(sp.status);
  const sourceLocationId = sp.sourceLocationId || undefined;
  const destinationLocationId = sp.destinationLocationId || undefined;

  const [result, index] = await Promise.all([
    listTransfers({
      page,
      pageSize: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(sourceLocationId ? { sourceLocationId } : {}),
      ...(destinationLocationId ? { destinationLocationId } : {}),
    }),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);
  const locationOptions = index.locations.filter((l) => l.status === 'active');

  function buildHref(next: {
    page?: number;
    status?: string | undefined;
    sourceLocationId?: string | undefined;
    destinationLocationId?: string | undefined;
  }): string {
    const params = new URLSearchParams();
    const nextStatus = 'status' in next ? next.status : status;
    const nextSource = 'sourceLocationId' in next ? next.sourceLocationId : sourceLocationId;
    const nextDest = 'destinationLocationId' in next ? next.destinationLocationId : destinationLocationId;
    if (nextStatus) params.set('status', nextStatus);
    if (nextSource) params.set('sourceLocationId', nextSource);
    if (nextDest) params.set('destinationLocationId', nextDest);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/inventory/transfers${params.toString() ? `?${params}` : ''}`;
  }

  const chip = (active: boolean) =>
    active
      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  const hasFilter = Boolean(status || sourceLocationId || destinationLocationId);

  return (
    <PageContainer>
      <PageHeader
        title="Transfers"
        description="Move stock between locations: request, approve, prepare, dispatch and receive."
        actions={canRequest ? <ButtonLink href="/inventory/transfers/new">New transfer</ButtonLink> : undefined}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ status: undefined })} aria-current={!status ? 'true' : undefined} className={chip(!status)}>
            All statuses
          </Link>
          {TRANSFER_STATUSES.map((s) => (
            <Link
              key={s}
              href={buildHref({ status: s })}
              aria-current={status === s ? 'true' : undefined}
              className={chip(status === s)}
            >
              {TRANSFER_STATUS_LABELS[s]}
            </Link>
          ))}
        </div>

        {locationOptions.length > 0 && (
          <form method="get" className="flex flex-wrap items-end gap-3">
            {status && <input type="hidden" name="status" value={status} />}
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              From location
              <select
                name="sourceLocationId"
                defaultValue={sourceLocationId ?? ''}
                className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900"
              >
                <option value="">Any</option>
                {locationOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              To location
              <select
                name="destinationLocationId"
                defaultValue={destinationLocationId ?? ''}
                className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900"
              >
                <option value="">Any</option>
                {locationOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Apply
            </button>
            {(sourceLocationId || destinationLocationId) && (
              <Link
                href={buildHref({ sourceLocationId: undefined, destinationLocationId: undefined })}
                className="h-9 rounded-md px-2 text-sm font-medium text-slate-500 hover:underline"
              >
                Clear locations
              </Link>
            )}
          </form>
        )}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No transfers match these filters' : 'No transfers yet'}
          description={
            hasFilter
              ? 'Try a different status or location.'
              : 'Create a transfer to move stock between two locations.'
          }
          {...(canRequest && !hasFilter
            ? { action: <ButtonLink href="/inventory/transfers/new">New transfer</ButtonLink> }
            : {})}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Transfer</TH>
                <TH>Status</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH className="text-right">Lines</TH>
                <TH className="text-right">In transit</TH>
                <TH>Created</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((transfer: Transfer) => {
                const inTransit = transfer.items.reduce((sum, item) => sum + item.quantityInTransit, 0);
                return (
                  <TR key={transfer.id}>
                    <TD>
                      <code className="text-xs text-slate-500">{shortId(transfer.id)}</code>
                    </TD>
                    <TD>
                      <Badge tone={transferStatusTone(transfer.status)}>
                        {TRANSFER_STATUS_LABELS[transfer.status as TransferStatus] ?? transfer.status}
                      </Badge>
                    </TD>
                    <TD className="text-slate-700">{index.locationName(transfer.sourceLocationId)}</TD>
                    <TD className="text-slate-700">{index.locationName(transfer.destinationLocationId)}</TD>
                    <TD className="text-right text-slate-500">{transfer.items.length}</TD>
                    <TD className="text-right text-slate-500">{inTransit}</TD>
                    <TD className="whitespace-nowrap text-slate-500">
                      {new Date(transfer.createdAt).toLocaleDateString()}
                    </TD>
                    <TD>
                      <Link
                        href={`/inventory/transfers/${transfer.id}`}
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
          <Pagination
            page={result.meta.page}
            pageSize={result.meta.pageSize}
            total={result.meta.total}
            totalPages={result.meta.totalPages}
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
