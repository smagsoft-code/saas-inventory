import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listCategories } from '../../../lib/catalog/categories';
import type { Category } from '../../../lib/types/catalog';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Categories · SaaS Inventory' };

const PAGE_SIZE = 20;
type StatusFilter = 'active' | 'inactive' | undefined;

function parseStatus(value: string | undefined): StatusFilter {
  return value === 'active' || value === 'inactive' ? value : undefined;
}

/**
 * Category list (`S-CAT-CATEGORIES`) — `GET /api/v1/categories` (`categories.view`), offset
 * paginated, `status` the only filter (no search / sort in the backend contract — not invented).
 * The parent column resolves names from a single `pageSize: 100` fetch (the max) — a tenant with
 * more than 100 categories is beyond the tested range (recorded in f17-gaps.md).
 */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('categories.view')) {
    return (
      <PageContainer>
        <PageHeader title="Categories" />
        <NoAccess message="You need the categories permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('categories.manage');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = parseStatus(sp.status);

  const [result, allForNames] = await Promise.all([
    listCategories({ page, pageSize: PAGE_SIZE, ...(status ? { status } : {}) }),
    listCategories({ pageSize: 100 }),
  ]);
  const nameById = new Map<string, string>(allForNames.data.map((c) => [c.id, c.name]));

  function filterHref(next: StatusFilter): string {
    const params = new URLSearchParams();
    if (next) params.set('status', next);
    return `/categories${params.toString() ? `?${params}` : ''}`;
  }
  function pageHref(nextPage: number): string {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/categories${params.toString() ? `?${params}` : ''}`;
  }

  const filters: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: undefined },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Categories"
        description="Organise the catalogue. A category defines which attributes its products carry."
        actions={
          canManage ? <ButtonLink href="/categories/new">New category</ButtonLink> : undefined
        }
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
          <EmptyState
            title="No categories match this filter"
            description="Try a different status."
          />
        ) : (
          <EmptyState
            title="No categories yet"
            description="Create your first category to start organising products."
            action={canManage ? <ButtonLink href="/categories/new">New category</ButtonLink> : undefined}
          />
        )
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Slug</TH>
                <TH>Parent</TH>
                <TH>Status</TH>
                <TH className="w-0"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((category: Category) => (
                <TR key={category.id}>
                  <TD className="font-medium">{category.name}</TD>
                  <TD className="text-slate-500">
                    <code className="text-xs">{category.slug}</code>
                  </TD>
                  <TD className="text-slate-500">
                    {category.parentCategoryId
                      ? nameById.get(category.parentCategoryId) ?? 'Subcategory'
                      : '—'}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(category.status)}>{category.status}</Badge>
                  </TD>
                  <TD>
                    <Link
                      href={`/categories/${category.id}`}
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
