import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { buildTransfersExportHref, listTransfers } from '../../../../lib/inventory/transfers';
import { fetchAllPages } from '../../../../lib/fetch-all';
import { ExportLinks } from '../../../../components/export-icons';
import { ListViewControls } from '../../../../components/list-view-controls';
import { getTransfersSummary } from '../../../../lib/inventory/reports';
import { buildLocationIndex } from '../../../../lib/inventory/location-index';
import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_LABELS,
  transferStatusTone,
  type Transfer,
  type TransferStatus,
} from '../../../../lib/types/inventory';
import type { TransfersSummary } from '../../../../lib/types/inventory-reports';
import { TransfersReportError, TransfersReportSection } from './transfers-report-section';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { ButtonLink } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { NoAccess } from '../../../../components/ui/no-access';
import { Pagination } from '../../../../components/ui/pagination';
import { Table, TBody, TD, TR } from '../../../../components/ui/table';
import {
  TransfersDateFilters,
  TransfersMobileFilters,
  TransfersTableHead,
} from './transfers-table-head';
import { TransfersMobileList, type MobileTransfer } from './transfers-mobile-list';

export const metadata = { title: 'Transferencias · SaaS Inventory' };

const PAGE_SIZE = 20;

function parseStatus(value: string | undefined): TransferStatus | undefined {
  return (TRANSFER_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as TransferStatus)
    : undefined;
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
  searchParams: Promise<{
    page?: string;
    status?: string;
    sourceLocationId?: string;
    destinationLocationId?: string;
    all?: string;
    createdFrom?: string;
    createdTo?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Transferencias" />
        <NoAccess message="Necesitas el permiso de inventario para ver esta página." />
      </PageContainer>
    );
  }
  const canRequest = checker.can('inventory.transfers.request');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = parseStatus(sp.status);
  const sourceLocationId = sp.sourceLocationId || undefined;
  const destinationLocationId = sp.destinationLocationId || undefined;
  // "Ver todos": every matching transfer on screen instead of one page.
  const createdFrom = sp.createdFrom || undefined;
  const createdTo = sp.createdTo || undefined;
  const showAll = sp.all === '1';
  const listFilters = {
    ...(status ? { status } : {}),
    ...(sourceLocationId ? { sourceLocationId } : {}),
    ...(destinationLocationId ? { destinationLocationId } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
  };

  // F18-08 transfer analytics — just the two groupBy-independent KPI tiles now (the "Agrupar por"
  // selector and its grouped breakdown table were removed per owner feedback); `groupBy` is sent
  // because the endpoint requires one, but nothing here depends on which value it resolves to.
  let transfersSummary: TransfersSummary | undefined;
  let summaryError:
    { status: number; message: string; correlationId: string | undefined } | undefined;
  try {
    transfersSummary = await getTransfersSummary({ groupBy: 'status' });
  } catch (error) {
    summaryError = {
      status: isApiError(error) ? error.status : 0,
      message: httpErrorMessage(error),
      correlationId: isApiError(error) ? error.correlationId : undefined,
    };
  }

  const [result, index] = await Promise.all([
    showAll
      ? fetchAllPages((p, size) => listTransfers({ ...listFilters, page: p, pageSize: size })).then(
          (all) => ({
            data: all.data,
            meta: {
              page: 1,
              pageSize: Math.max(all.data.length, PAGE_SIZE),
              total: all.total,
              totalPages: 1,
            },
            truncated: all.truncated,
          }),
        )
      : listTransfers({ ...listFilters, page, pageSize: PAGE_SIZE }).then((paged) => ({
          ...paged,
          truncated: false,
        })),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);
  const locationOptions = index.locations.filter((l) => l.status === 'active');

  function buildHref(next: {
    page?: number;
    all?: boolean;
    status?: string | undefined;
    sourceLocationId?: string | undefined;
    destinationLocationId?: string | undefined;
  }): string {
    const params = new URLSearchParams();
    const nextStatus = 'status' in next ? next.status : status;
    const nextSource = 'sourceLocationId' in next ? next.sourceLocationId : sourceLocationId;
    const nextDest =
      'destinationLocationId' in next ? next.destinationLocationId : destinationLocationId;
    if (nextStatus) params.set('status', nextStatus);
    if (nextSource) params.set('sourceLocationId', nextSource);
    if (nextDest) params.set('destinationLocationId', nextDest);
    if (createdFrom) params.set('createdFrom', createdFrom);
    if (createdTo) params.set('createdTo', createdTo);
    if (next.all ?? false) params.set('all', '1');
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/inventory/transfers${params.toString() ? `?${params}` : ''}`;
  }

  const mobileTransfers: MobileTransfer[] = result.data.map((transfer: Transfer) => ({
    id: transfer.id,
    code: transfer.code,
    status: transfer.status,
    statusLabel: TRANSFER_STATUS_LABELS[transfer.status as TransferStatus] ?? transfer.status,
    statusTone: transferStatusTone(transfer.status),
    sourceLabel: index.locationName(transfer.sourceLocationId),
    destinationLabel: index.locationName(transfer.destinationLocationId),
    lineCount: transfer.items.length,
    inTransit: transfer.items.reduce((sum, item) => sum + item.quantityInTransit, 0),
    createdLabel: new Date(transfer.createdAt).toLocaleDateString(),
  }));

  const carried: Record<string, string> = {
    ...(showAll ? { all: '1' } : {}),
    ...(status ? { status } : {}),
    ...(sourceLocationId ? { sourceLocationId } : {}),
    ...(destinationLocationId ? { destinationLocationId } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
  };
  const statusOptions = TRANSFER_STATUSES.map((s) => ({
    value: s,
    label: TRANSFER_STATUS_LABELS[s],
  }));
  const headLocationOptions = locationOptions.map((l) => ({ value: l.id, label: l.name }));

  const hasFilter = Boolean(
    status || sourceLocationId || destinationLocationId || createdFrom || createdTo,
  );

  return (
    <PageContainer>
      <PageHeader
        actionsBeside
        title="Transferencias"
        help="Mueve stock entre almacenes: solicitar, aprobar, preparar, despachar y recibir."
        actions={
          <div className="flex flex-wrap items-end justify-end gap-3">
            <div className="hidden md:block">
              <TransfersDateFilters params={carried} inline />
            </div>
            {canRequest && (
              <ButtonLink href="/inventory/transfers/new">
                <span className="md:hidden">Nueva</span>
                <span className="hidden md:inline">Nueva transferencia</span>
              </ButtonLink>
            )}
          </div>
        }
      />

      <section aria-labelledby="report-heading" id="report" className="flex flex-col gap-3">
        <h2 id="report-heading" className="text-sm font-semibold text-slate-900">
          Reporte de transferencias
        </h2>
        {transfersSummary ? (
          <TransfersReportSection summary={transfersSummary} />
        ) : (
          summaryError && (
            <TransfersReportError
              status={summaryError.status}
              message={summaryError.message}
              correlationId={summaryError.correlationId}
            />
          )
        )}
      </section>

      <hr className="border-slate-200" />

      <div className="hidden items-center justify-between gap-3 md:flex">
        <h2 className="text-sm font-semibold text-slate-900">Listado de transferencias</h2>
        {!(result.data.length === 0 && !hasFilter) && (
          <ListViewControls
            showingAll={showAll}
            allHref={buildHref({ all: true })}
            pagedHref={buildHref({})}
            shown={result.data.length}
            total={result.meta.total}
            truncated={result.truncated}
            canToggle={result.meta.total > PAGE_SIZE}
            excelHref={buildTransfersExportHref(listFilters, 'xlsx')}
            pdfHref={buildTransfersExportHref(listFilters, 'pdf')}
          />
        )}
      </div>

      {result.data.length === 0 && !hasFilter ? (
        <EmptyState
          title="Aún no hay transferencias"
          description="Crea una transferencia para mover stock entre dos almacenes."
          {...(canRequest
            ? {
                action: (
                  <ButtonLink href="/inventory/transfers/new">Nueva transferencia</ButtonLink>
                ),
              }
            : {})}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            <TransfersMobileFilters
              params={carried}
              statusOptions={statusOptions}
              locationOptions={headLocationOptions}
              actions={
                <ExportLinks
                  excelHref={buildTransfersExportHref(listFilters, 'xlsx')}
                  pdfHref={buildTransfersExportHref(listFilters, 'pdf')}
                />
              }
            />
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Listado de transferencias ({result.meta.total})
              </h3>
              {(result.meta.total > PAGE_SIZE || showAll) && (
                <Link
                  href={showAll ? buildHref({}) : buildHref({ all: true })}
                  className="text-xs font-semibold text-blue-700"
                >
                  {showAll ? 'Ver paginado' : 'Ver todos'}
                </Link>
              )}
            </div>
            {mobileTransfers.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Ninguna transferencia coincide con estos filtros.
              </p>
            ) : (
              <TransfersMobileList transfers={mobileTransfers} />
            )}
          </div>
          <div className="hidden md:block">
            <Table className="table-fixed text-xs">
              <TransfersTableHead
                params={carried}
                statusOptions={statusOptions}
                locationOptions={headLocationOptions}
              />
              <TBody>
                {result.data.length === 0 && (
                  <TR>
                    <TD colSpan={8} className="py-10 text-center text-sm text-slate-500">
                      Ninguna transferencia coincide con estos filtros.
                    </TD>
                  </TR>
                )}
                {result.data.map((transfer: Transfer) => {
                  const inTransit = transfer.items.reduce(
                    (sum, item) => sum + item.quantityInTransit,
                    0,
                  );
                  return (
                    <TR key={transfer.id}>
                      <TD>
                        <span className="font-mono text-xs text-slate-700">{transfer.code}</span>
                      </TD>
                      <TD>
                        <Badge tone={transferStatusTone(transfer.status)}>
                          {TRANSFER_STATUS_LABELS[transfer.status as TransferStatus] ??
                            transfer.status}
                        </Badge>
                      </TD>
                      <TD className="text-slate-700">
                        {index.locationName(transfer.sourceLocationId)}
                      </TD>
                      <TD className="text-slate-700">
                        {index.locationName(transfer.destinationLocationId)}
                      </TD>
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
                          Ver
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
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
