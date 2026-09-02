import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listProducts } from '../../../lib/catalog/products';
import { listCategories } from '../../../lib/catalog/categories';
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, type Product, type ProductStatus } from '../../../lib/types/products';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Products · SaaS Inventory' };

const PAGE_SIZE = 20;

function parseStatus(value: string | undefined): ProductStatus | undefined {
  return (PRODUCT_STATUSES as readonly string[]).includes(value ?? '') ? (value as ProductStatus) : undefined;
}

/**
 * Product list (`S-CAT-PRODUCTS`) — `GET /api/v1/products` (`products.view`), offset paginated.
 * Real filters only: `status` and `categoryId` (no free-text search / sort in the backend
 * contract — `GAP-SEARCH` / `GAP-SORT`, not invented). Category names resolve from one
 * `pageSize: 100` categories fetch; price / stock / variant count are not on this endpoint.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; categoryId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.view')) {
    return (
      <PageContainer>
        <PageHeader title="Products" />
        <NoAccess message="You need the products permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('products.manage');
  const canViewCategories = checker.can('categories.view');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = parseStatus(sp.status);
  const categoryId = sp.categoryId || undefined;

  const [result, categories] = await Promise.all([
    listProducts({
      page,
      pageSize: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
    }),
    canViewCategories ? listCategories({ pageSize: 100 }) : Promise.resolve(null),
  ]);
  const categoryName = new Map<string, string>((categories?.data ?? []).map((c) => [c.id, c.name]));

  function buildHref(next: { page?: number; status?: ProductStatus | undefined; categoryId?: string | undefined }): string {
    const params = new URLSearchParams();
    const nextStatus = 'status' in next ? next.status : status;
    const nextCategory = 'categoryId' in next ? next.categoryId : categoryId;
    if (nextStatus) params.set('status', nextStatus);
    if (nextCategory) params.set('categoryId', nextCategory);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/products${params.toString() ? `?${params}` : ''}`;
  }

  const statusFilters: { label: string; value: ProductStatus | undefined }[] = [
    { label: 'All', value: undefined },
    ...PRODUCT_STATUSES.map((s) => ({ label: PRODUCT_STATUS_LABELS[s], value: s })),
  ];
  const hasFilter = Boolean(status || categoryId);

  return (
    <PageContainer>
      <PageHeader
        title="Products"
        description="The catalogue. Each product carries at least one variant (SKU)."
        actions={canManage ? <ButtonLink href="/products/new">New product</ButtonLink> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {statusFilters.map((f) => {
            const active = status === f.value;
            return (
              <Link
                key={f.label}
                href={buildHref({ status: f.value })}
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

        {categories && categories.data.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ categoryId: undefined })}
              aria-current={!categoryId ? 'true' : undefined}
              className={
                !categoryId
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
              }
            >
              All categories
            </Link>
            {categories.data.map((category) => {
              const active = categoryId === category.id;
              return (
                <Link
                  key={category.id}
                  href={buildHref({ categoryId: category.id })}
                  aria-current={active ? 'true' : undefined}
                  className={
                    active
                      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
                  }
                >
                  {category.name}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {result.data.length === 0 ? (
        hasFilter ? (
          <EmptyState title="No products match these filters" description="Try a different status or category." />
        ) : (
          <EmptyState
            title="No products yet"
            description="Create your first product to start building the catalogue."
            action={canManage ? <ButtonLink href="/products/new">New product</ButtonLink> : undefined}
          />
        )
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Category</TH>
                <TH>Warranty</TH>
                <TH>Status</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((product: Product) => (
                <TR key={product.id}>
                  <TD className="font-medium">{product.name}</TD>
                  <TD className="text-slate-500">
                    {product.categoryId ? categoryName.get(product.categoryId) ?? 'Category' : '—'}
                  </TD>
                  <TD className="text-slate-500">
                    {typeof product.warrantyMonths === 'number' ? `${product.warrantyMonths} mo` : '—'}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(product.status)}>
                      {PRODUCT_STATUS_LABELS[product.status as ProductStatus] ?? product.status}
                    </Badge>
                  </TD>
                  <TD>
                    <Link
                      href={`/products/${product.id}`}
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
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
