import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listCustomers } from '../../../lib/sales/customers';
import {
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type Customer,
  type CustomerStatus,
  type CustomerType,
} from '../../../lib/types/sales';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Customers · SaaS Inventory' };

const PAGE_SIZE = 20;

function parseType(value: string | undefined): CustomerType | undefined {
  return (CUSTOMER_TYPES as readonly string[]).includes(value ?? '') ? (value as CustomerType) : undefined;
}
function parseStatus(value: string | undefined): CustomerStatus | undefined {
  return (CUSTOMER_STATUSES as readonly string[]).includes(value ?? '') ? (value as CustomerStatus) : undefined;
}

/**
 * Customers list (`S-CUST-LIST`) — `GET /api/v1/customers` (`sales.customers.view`), offset
 * paginated. Real filters only: `q` (free-text over displayName / taxId / email / phone — the one
 * endpoint that has real search, `GAP-SEARCH`), `status`, `type`. No sort. The search box is a
 * native GET form — the backend does the matching, never the client.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; type?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.customers.view')) {
    return (
      <PageContainer>
        <PageHeader title="Customers" />
        <NoAccess message="You need the customers permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('sales.customers.manage');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() || undefined;
  const status = parseStatus(sp.status);
  const type = parseType(sp.type);

  const result = await listCustomers({
    page,
    pageSize: PAGE_SIZE,
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  });

  function buildHref(nextPage: number): string {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/customers${params.toString() ? `?${params}` : ''}`;
  }

  const hasFilter = Boolean(q || status || type);

  return (
    <PageContainer>
      <PageHeader
        title="Customers"
        description="The people and businesses you sell to."
        actions={canManage ? <ButtonLink href="/customers/new">New customer</ButtonLink> : undefined}
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600 sm:max-w-xs">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name, tax id, email or phone"
            className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Type
          <select name="type" defaultValue={type ?? ''} className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900">
            <option value="">Any</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Status
          <select name="status" defaultValue={status ?? ''} className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900">
            <option value="">Any</option>
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Search
        </button>
        {hasFilter && (
          <Link href="/customers" className="h-9 rounded-md px-2 text-sm font-medium text-slate-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No customers match your search' : 'No customers yet'}
          description={hasFilter ? 'Try a different term or clear the filters.' : 'Add a customer to start selling.'}
          {...(canManage && !hasFilter
            ? { action: <ButtonLink href="/customers/new">New customer</ButtonLink> }
            : {})}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Tax id</TH>
                <TH>Email</TH>
                <TH>Phone</TH>
                <TH>Status</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((customer: Customer) => (
                <TR key={customer.id}>
                  <TD className="font-medium">{customer.displayName}</TD>
                  <TD className="text-slate-500">
                    {CUSTOMER_TYPE_LABELS[customer.type as CustomerType] ?? customer.type}
                  </TD>
                  <TD className="text-slate-500">{customer.taxId ?? '—'}</TD>
                  <TD className="text-slate-500">{customer.email ?? '—'}</TD>
                  <TD className="text-slate-500">{customer.phone ?? '—'}</TD>
                  <TD>
                    <Badge tone={statusTone(customer.status)}>{customer.status}</Badge>
                  </TD>
                  <TD>
                    <Link
                      href={`/customers/${customer.id}`}
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
            buildHref={buildHref}
          />
        </>
      )}
    </PageContainer>
  );
}
