import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { listTransfers } from '../../../../lib/inventory/transfers';
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
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

export const metadata = { title: 'Transferencias · SaaS Inventory' };

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
  searchParams: Promise<{
    page?: string;
    status?: string;
    sourceLocationId?: string;
    destinationLocationId?: string;
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

  // F18-08 transfer analytics — just the two groupBy-independent KPI tiles now (the "Agrupar por"
  // selector and its grouped breakdown table were removed per owner feedback); `groupBy` is sent
  // because the endpoint requires one, but nothing here depends on which value it resolves to.
  let transfersSummary: TransfersSummary | undefined;
  let summaryError: { status: number; message: string; correlationId: string | undefined } | undefined;
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

  const hasFilter = Boolean(status || sourceLocationId || destinationLocationId);

  return (
    <PageContainer>
      <PageHeader
        title="Transferencias"
        description="Mueve stock entre almacenes: solicitar, aprobar, preparar, despachar y recibir."
        actions={canRequest ? <ButtonLink href="/inventory/transfers/new">Nueva transferencia</ButtonLink> : undefined}
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

      <h2 className="text-sm font-semibold text-slate-900">Listado de transferencias</h2>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Estado
          <select
            name="status"
            defaultValue={status ?? ''}
            className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900"
          >
            <option value="">Todos los estados</option>
            {TRANSFER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TRANSFER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {locationOptions.length > 0 && (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Almacén de origen
              <select
                name="sourceLocationId"
                defaultValue={sourceLocationId ?? ''}
                className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900"
              >
                <option value="">Cualquiera</option>
                {locationOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Almacén de destino
              <select
                name="destinationLocationId"
                defaultValue={destinationLocationId ?? ''}
                className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900"
              >
                <option value="">Cualquiera</option>
                {locationOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Aplicar
        </button>
        {hasFilter && (
          <Link
            href={buildHref({ status: undefined, sourceLocationId: undefined, destinationLocationId: undefined })}
            className="h-9 rounded-md px-2 text-sm font-medium text-slate-500 hover:underline"
          >
            Quitar filtros
          </Link>
        )}
      </form>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'Ninguna transferencia coincide con estos filtros' : 'Aún no hay transferencias'}
          description={
            hasFilter
              ? 'Prueba con otro estado o almacén.'
              : 'Crea una transferencia para mover stock entre dos almacenes.'
          }
          {...(canRequest && !hasFilter
            ? { action: <ButtonLink href="/inventory/transfers/new">Nueva transferencia</ButtonLink> }
            : {})}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Transferencia</TH>
                <TH>Estado</TH>
                <TH>Origen</TH>
                <TH>Destino</TH>
                <TH className="text-right">Líneas</TH>
                <TH className="text-right">En tránsito</TH>
                <TH>Creada</TH>
                <TH className="w-0">
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((transfer: Transfer) => {
                const inTransit = transfer.items.reduce((sum, item) => sum + item.quantityInTransit, 0);
                return (
                  <TR key={transfer.id}>
                    <TD>
                      <span className="font-mono text-xs text-slate-700">{transfer.code}</span>
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
                        Ver
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
