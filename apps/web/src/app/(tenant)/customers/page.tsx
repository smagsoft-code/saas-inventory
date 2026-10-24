import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { buildCustomersExportHref, listCustomers } from '../../../lib/sales/customers';
import { fetchAllPages } from '../../../lib/fetch-all';
import { ListViewControls } from '../../../components/list-view-controls';
import { CUSTOMER_TYPE_LABELS, type Customer, type CustomerType } from '../../../lib/types/sales';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { CustomersSearch } from './customers-search';

export const metadata = { title: 'Clientes · SaaS Inventory' };

const PAGE_SIZE = 20;

/**
 * Customers list (`S-CUST-LIST`) — `GET /api/v1/customers` (`sales.customers.view`), offset
 * paginated. Owner redesign: only a live `q` search box (firstName/lastName/taxId/email/phone) —
 * no Tipo/Estado filters, no Buscar submit button. Columns: Nombre | Tipo | Cédula/Ruc | Correo |
 * Teléfono | [editar icon].
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; all?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.customers.view')) {
    return (
      <PageContainer>
        <PageHeader title="Clientes" />
        <NoAccess message="Necesitas el permiso de clientes para ver esta página." />
      </PageContainer>
    );
  }
  const canManage = checker.can('sales.customers.manage');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() || undefined;
  // "Ver todos": every matching customer on screen instead of one page.
  const showAll = sp.all === '1';

  const result = showAll
    ? await fetchAllPages((p, size) => listCustomers({ page: p, pageSize: size, ...(q ? { q } : {}) })).then((all) => ({
        data: all.data,
        meta: { page: 1, pageSize: Math.max(all.data.length, PAGE_SIZE), total: all.total, totalPages: 1 },
        truncated: all.truncated,
      }))
    : await listCustomers({ page, pageSize: PAGE_SIZE, ...(q ? { q } : {}) }).then((paged) => ({ ...paged, truncated: false }));

  function buildHref(nextPage: number, all = false): string {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (all) params.set('all', '1');
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/customers${params.toString() ? `?${params}` : ''}`;
  }

  const hasFilter = Boolean(q);

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        help="Las personas y empresas a las que vendes."
        actions={canManage ? <ButtonLink href="/customers/new">Nuevo cliente</ButtonLink> : undefined}
      />

      <CustomersSearch initialQ={q ?? ''} showAll={showAll} />

      <ListViewControls
        showingAll={showAll}
        allHref={buildHref(1, true)}
        pagedHref={buildHref(1)}
        shown={result.data.length}
        total={result.meta.total}
        truncated={result.truncated}
        canToggle={result.meta.total > PAGE_SIZE}
        excelHref={buildCustomersExportHref({ ...(q ? { q } : {}) }, 'xlsx')}
        pdfHref={buildCustomersExportHref({ ...(q ? { q } : {}) }, 'pdf')}
      />

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'Ningún cliente coincide con tu búsqueda' : 'Aún no hay clientes'}
          description={hasFilter ? 'Prueba con otro término.' : 'Agrega un cliente para empezar a vender.'}
          {...(canManage && !hasFilter
            ? { action: <ButtonLink href="/customers/new">Nuevo cliente</ButtonLink> }
            : {})}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Tipo</TH>
                <TH>Cédula/Ruc</TH>
                <TH>Correo</TH>
                <TH>Teléfono</TH>
                <TH className="w-0">
                  <span className="sr-only">Acciones</span>
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
                    <Link
                      href={`/customers/${customer.id}`}
                      aria-label={`${canManage ? 'Editar' : 'Ver'} ${customer.displayName}`}
                      title={canManage ? 'Editar' : 'Ver'}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.862 4.487a2.06 2.06 0 0 1 2.915 2.914L8.5 18.678l-4 1 1-4Z"
                        />
                      </svg>
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
