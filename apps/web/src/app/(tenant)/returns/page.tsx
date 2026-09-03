import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listReturns } from '../../../lib/sales/returns';
import { buildLocationIndex, shortId } from '../../../lib/inventory/location-index';
import {
  RETURN_STATUSES,
  RETURN_STATUS_LABELS,
  returnStatusTone,
  type ReturnStatus,
} from '../../../lib/types/sales';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Returns · SaaS Inventory' };

const PAGE_SIZE = 20;

function pickStatus(value: string | undefined): ReturnStatus | undefined {
  return (RETURN_STATUSES as readonly string[]).includes(value ?? '') ? (value as ReturnStatus) : undefined;
}

/**
 * Sales returns list (`S-RET-LIST`) — `GET /api/v1/sales-returns` (`sales.returns.view`), offset
 * paginated. Real filters only: a single `status` (`GAP-MULTI-STATUS`) and `orderId` — no text
 * search, no sort, no date range. The DTO carries FK ids only; the location name comes from one
 * bounded `buildLocationIndex()` fetch, the return + order ids show as short codes
 * (`GAP-NAME-ENRICHMENT` — there is no return number and no `orderNumber` on the DTO). Visibility
 * is tenant-wide for a `sales.returns.view` holder.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; orderId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.returns.view')) {
    return (
      <PageContainer>
        <PageHeader title="Returns" />
        <NoAccess message="You need the returns permission to view this page." />
      </PageContainer>
    );
  }
  const canCreate = checker.can('sales.returns.create');
  const canViewOrders = checker.can('sales.orders.view');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = pickStatus(sp.status);
  const orderId = sp.orderId || undefined;

  const [result, index] = await Promise.all([
    listReturns({ page, pageSize: PAGE_SIZE, ...(status ? { status } : {}), ...(orderId ? { orderId } : {}) }),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);

  function buildHref(next: { page?: number; status?: string | null; orderId?: string | null }): string {
    const params = new URLSearchParams();
    const nextStatus = next.status === undefined ? status : next.status || undefined;
    const nextOrderId = next.orderId === undefined ? orderId : next.orderId || undefined;
    if (nextStatus) params.set('status', nextStatus);
    if (nextOrderId) params.set('orderId', nextOrderId);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/returns${params.toString() ? `?${params}` : ''}`;
  }

  const chip = (active: boolean) =>
    active
      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  const hasFilter = Boolean(status || orderId);

  return (
    <PageContainer>
      <PageHeader
        title="Returns"
        description="Reversals of confirmed sales — request, inspect, and resolve the disposition of returned goods."
        actions={canCreate ? <ButtonLink href="/returns/new">New return</ButtonLink> : undefined}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ status: null })} aria-current={!status ? 'true' : undefined} className={chip(!status)}>
            All statuses
          </Link>
          {RETURN_STATUSES.map((s) => (
            <Link
              key={s}
              href={buildHref({ status: s })}
              aria-current={status === s ? 'true' : undefined}
              className={chip(status === s)}
            >
              {RETURN_STATUS_LABELS[s]}
            </Link>
          ))}
        </div>

        {orderId && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            Filtered to one order
            {canViewOrders ? (
              <Link href={`/sales/${orderId}`} className="font-medium text-slate-700 underline underline-offset-2">
                {shortId(orderId)}
              </Link>
            ) : (
              <code className="text-xs">{shortId(orderId)}</code>
            )}
            <Link href={buildHref({ orderId: null })} className="text-xs font-medium text-slate-500 hover:underline">
              Clear
            </Link>
          </p>
        )}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No returns match these filters' : 'No returns yet'}
          description={
            hasFilter ? 'Try a different status.' : 'A return is filed against a confirmed order when goods come back.'
          }
          {...(canCreate && !hasFilter ? { action: <ButtonLink href="/returns/new">New return</ButtonLink> } : {})}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Return</TH>
                <TH>Order</TH>
                <TH>Received at</TH>
                <TH className="text-right">Lines</TH>
                <TH>Status</TH>
                <TH>Created</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((ret) => (
                <TR key={ret.id}>
                  <TD>
                    <code className="text-xs text-slate-500">{shortId(ret.id)}</code>
                  </TD>
                  <TD>
                    {canViewOrders ? (
                      <Link
                        href={`/sales/${ret.orderId}`}
                        className="font-medium text-slate-700 underline-offset-2 hover:underline"
                      >
                        {shortId(ret.orderId)}
                      </Link>
                    ) : (
                      <code className="text-xs text-slate-500">{shortId(ret.orderId)}</code>
                    )}
                  </TD>
                  <TD className="text-slate-500">{index.locationName(ret.locationId)}</TD>
                  <TD className="text-right text-slate-500">{ret.items.length}</TD>
                  <TD>
                    <Badge tone={returnStatusTone(ret.status)}>
                      {RETURN_STATUS_LABELS[ret.status as ReturnStatus] ?? ret.status}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-slate-500">{new Date(ret.createdAt).toLocaleDateString()}</TD>
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
