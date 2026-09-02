import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listWarehouses } from '../../../lib/inventory/warehouses';
import type { Warehouse } from '../../../lib/types/inventory';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Warehouses · SaaS Inventory' };

const PAGE_SIZE = 20;
type StatusFilter = 'active' | 'inactive' | undefined;

function parseStatus(value: string | undefined): StatusFilter {
  return value === 'active' || value === 'inactive' ? value : undefined;
}

function formatAddress(address: Record<string, unknown> | undefined): string {
  if (!address) {
    return '—';
  }
  const parts = ['line1', 'city', 'state', 'country']
    .map((key) => address[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return parts.length > 0 ? parts.join(', ') : '—';
}

/**
 * Warehouse list (`S-WH-LIST`) — `GET /api/v1/warehouses` (`warehouses.view`), offset paginated,
 * `status` the only filter (no search / sort in the backend contract — not invented). Each row
 * links to the detail/edit screen. Creating a warehouse auto-creates its "General" location.
 */
export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('warehouses.view')) {
    return (
      <PageContainer>
        <PageHeader title="Warehouses" />
        <NoAccess message="You need the warehouses permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('warehouses.manage');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = parseStatus(sp.status);

  const result = await listWarehouses({ page, pageSize: PAGE_SIZE, ...(status ? { status } : {}) });

  function filterHref(next: StatusFilter): string {
    const params = new URLSearchParams();
    if (next) params.set('status', next);
    return `/warehouses${params.toString() ? `?${params}` : ''}`;
  }
  function pageHref(nextPage: number): string {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/warehouses${params.toString() ? `?${params}` : ''}`;
  }

  const filters: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: undefined },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Warehouses"
        description="Physical sites that hold stock. Every warehouse has at least one location."
        actions={canManage ? <ButtonLink href="/warehouses/new">New warehouse</ButtonLink> : undefined}
      />

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = status === f.value;
          return (
            <Link
              key={f.label}
              href={filterHref(f.value)}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {result.data.length === 0 ? (
        status ? (
          <EmptyState title="No warehouses match this filter" description="Try a different status." />
        ) : (
          <EmptyState
            title="No warehouses yet"
            description="Create your first warehouse to start tracking stock by site."
            action={canManage ? <ButtonLink href="/warehouses/new">New warehouse</ButtonLink> : undefined}
          />
        )
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Code</TH>
                <TH>Address</TH>
                <TH>Status</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((warehouse: Warehouse) => (
                <TR key={warehouse.id}>
                  <TD className="font-medium">{warehouse.name}</TD>
                  <TD className="text-slate-500">
                    <code className="text-xs">{warehouse.code}</code>
                  </TD>
                  <TD className="text-slate-500">{formatAddress(warehouse.address)}</TD>
                  <TD>
                    <Badge tone={statusTone(warehouse.status)}>{warehouse.status}</Badge>
                  </TD>
                  <TD>
                    <Link
                      href={`/warehouses/${warehouse.id}`}
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      {canManage ? 'Edit' : 'View'}
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
            buildHref={pageHref}
          />
        </>
      )}
    </PageContainer>
  );
}
