import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import { listMovements } from '../../../../lib/inventory/movements';
import { getMovementsSummary } from '../../../../lib/inventory/reports';
import { buildLocationIndex, shortId } from '../../../../lib/inventory/location-index';
import { tenantStartOfDayUtc } from '../../../../lib/home/tenant-day';
import {
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  type InventoryMovement,
  type MovementType,
} from '../../../../lib/types/inventory';
import {
  MOVEMENTS_SUMMARY_GROUP_BY,
  type MovementsSummary,
  type MovementsSummaryGroupBy,
} from '../../../../lib/types/inventory-reports';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { NoAccess } from '../../../../components/ui/no-access';
import { Pagination } from '../../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import { MovementsDateFilter } from './movements-date-filter';
import { MovementsReportFilters, type MovementsReportFilterValues } from './movements-report-filters';
import { MovementsReportError, MovementsReportSection } from './movements-report-section';

export const metadata = { title: 'Inventory movements · SaaS Inventory' };

const PAGE_SIZE = 20;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function parseMovementType(value: string | undefined): MovementType | undefined {
  return (MOVEMENT_TYPES as readonly string[]).includes(value ?? '') ? (value as MovementType) : undefined;
}

function pickReportGroupBy(value: string | undefined): MovementsSummaryGroupBy {
  return (MOVEMENTS_SUMMARY_GROUP_BY as readonly string[]).includes(value ?? '') ? (value as MovementsSummaryGroupBy) : 'day';
}

/**
 * Movement history / kardex (`S-INV-MOVEMENTS`) — `GET /api/v1/inventory/movements`
 * (`inventory.view`), offset paginated. Real filters: `locationId`, `movementType`,
 * `occurredFrom`/`occurredTo` (half-open `[occurredFrom, occurredTo)` on `occurred_at`, F18-03 —
 * `GAP-MOVEMENTS-DATE-FILTER` resolved) and (from a drill-in) `productVariantId`. **Still no
 * sort** — rows are shown in the order the endpoint returns them (newest first). FK ids only.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    locationId?: string;
    movementType?: string;
    productVariantId?: string;
    occurredFrom?: string;
    occurredTo?: string;
    reportFrom?: string;
    reportTo?: string;
    reportGroupBy?: string;
    reportMovementType?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Inventory movements" />
        <NoAccess message="You need the inventory permission to view this page." />
      </PageContainer>
    );
  }
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const locationId = sp.locationId || undefined;
  const movementType = parseMovementType(sp.movementType);
  const productVariantId = sp.productVariantId || undefined;
  const occurredFrom = sp.occurredFrom || undefined;
  const occurredTo = sp.occurredTo || undefined;

  // F18-07 movements report — a separate section, its own params, independent of the list below.
  const now = new Date();
  const reportFrom = sp.reportFrom || tenantStartOfDayUtc(session?.timezone ?? 'UTC', new Date(now.getTime() - THIRTY_DAYS_MS));
  const reportTo = sp.reportTo || now.toISOString();
  const reportGroupBy = pickReportGroupBy(sp.reportGroupBy);
  const reportMovementType = parseMovementType(sp.reportMovementType);
  const reportFilters: MovementsReportFilterValues = {
    from: reportFrom,
    to: reportTo,
    groupBy: reportGroupBy,
    ...(reportMovementType ? { movementType: reportMovementType } : {}),
  };

  // The report section is independent of the operational list's location/variant chips — its own
  // from/to/groupBy/movementType only (mirrors /sales, where the report and history filters never
  // share state). `locationId`/`productVariantId` remain available on the endpoint for API callers.
  let movementsSummary: MovementsSummary | undefined;
  let summaryError: { status: number; message: string; correlationId: string | undefined } | undefined;
  try {
    movementsSummary = await getMovementsSummary({
      from: reportFrom,
      to: reportTo,
      groupBy: reportGroupBy,
      ...(reportMovementType ? { movementType: reportMovementType } : {}),
    });
  } catch (error) {
    summaryError = {
      status: isApiError(error) ? error.status : 0,
      message: httpErrorMessage(error),
      correlationId: isApiError(error) ? error.correlationId : undefined,
    };
  }

  const [result, index] = await Promise.all([
    listMovements({
      page,
      pageSize: PAGE_SIZE,
      ...(locationId ? { locationId } : {}),
      ...(movementType ? { movementType } : {}),
      ...(productVariantId ? { productVariantId } : {}),
      ...(occurredFrom ? { occurredFrom } : {}),
      ...(occurredTo ? { occurredTo } : {}),
    }),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);
  // Reuse the index's own location fetch for the filter chips — no second GET /locations.
  const locationChips = index.locations.filter((l) => l.status === 'active');

  function buildHref(next: {
    page?: number;
    locationId?: string | undefined;
    movementType?: MovementType | undefined;
    productVariantId?: string | undefined;
    occurredFrom?: string | undefined;
    occurredTo?: string | undefined;
  }): string {
    const params = new URLSearchParams();
    const nextLocation = 'locationId' in next ? next.locationId : locationId;
    const nextType = 'movementType' in next ? next.movementType : movementType;
    const nextVariant = 'productVariantId' in next ? next.productVariantId : productVariantId;
    const nextFrom = 'occurredFrom' in next ? next.occurredFrom : occurredFrom;
    const nextTo = 'occurredTo' in next ? next.occurredTo : occurredTo;
    if (nextLocation) params.set('locationId', nextLocation);
    if (nextType) params.set('movementType', nextType);
    if (nextVariant) params.set('productVariantId', nextVariant);
    if (nextFrom) params.set('occurredFrom', nextFrom);
    if (nextTo) params.set('occurredTo', nextTo);
    // Carry the report section's own params forward — paginating / filtering the list must not
    // silently reset the report back to its default period (mirrors /sales, F18-02).
    if (sp.reportFrom) params.set('reportFrom', sp.reportFrom);
    if (sp.reportTo) params.set('reportTo', sp.reportTo);
    if (sp.reportGroupBy) params.set('reportGroupBy', sp.reportGroupBy);
    if (sp.reportMovementType) params.set('reportMovementType', sp.reportMovementType);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/inventory/movements${params.toString() ? `?${params}` : ''}`;
  }

  const chip = (active: boolean) =>
    active
      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  const hasFilter = Boolean(locationId || movementType || productVariantId || occurredFrom || occurredTo);

  return (
    <PageContainer>
      <PageHeader
        title="Inventory movements"
        description="The append-only stock ledger: every receipt, sale, transfer, reservation and adjustment."
      />

      <section aria-labelledby="report-heading" id="report" className="flex flex-col gap-3">
        <h2 id="report-heading" className="text-sm font-semibold text-slate-900">
          Movements report
        </h2>
        <MovementsReportFilters initial={reportFilters} />
        {movementsSummary ? (
          <MovementsReportSection summary={movementsSummary} />
        ) : (
          summaryError && (
            <MovementsReportError status={summaryError.status} message={summaryError.message} correlationId={summaryError.correlationId} />
          )
        )}
      </section>

      <hr className="border-slate-200" />

      <h2 className="text-sm font-semibold text-slate-900">Movement history</h2>

      <MovementsDateFilter initial={{ occurredFrom, occurredTo }} />

      <div className="flex flex-col gap-3">
        {productVariantId && (
          <div>
            <Link
              href={buildHref({ productVariantId: undefined })}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Variant {shortId(productVariantId)} <span aria-hidden="true">×</span>
              <span className="sr-only">Clear variant filter</span>
            </Link>
          </div>
        )}

        {locationChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Link href={buildHref({ locationId: undefined })} aria-current={!locationId ? 'true' : undefined} className={chip(!locationId)}>
              All locations
            </Link>
            {locationChips.map((location) => (
              <Link
                key={location.id}
                href={buildHref({ locationId: location.id })}
                aria-current={locationId === location.id ? 'true' : undefined}
                className={chip(locationId === location.id)}
              >
                {location.name}
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ movementType: undefined })} aria-current={!movementType ? 'true' : undefined} className={chip(!movementType)}>
            All types
          </Link>
          {MOVEMENT_TYPES.map((type) => (
            <Link
              key={type}
              href={buildHref({ movementType: type })}
              aria-current={movementType === type ? 'true' : undefined}
              className={chip(movementType === type)}
            >
              {MOVEMENT_TYPE_LABELS[type]}
            </Link>
          ))}
        </div>
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No movements match these filters' : 'No movements recorded yet'}
          description={hasFilter ? 'Try a different location, type or date range.' : 'Movements appear here as stock changes.'}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Type</TH>
                <TH>Location</TH>
                <TH className="text-right">Quantity</TH>
                <TH className="text-right">Balance after</TH>
                <TH>Reason / reference</TH>
                <TH>Actor</TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((movement: InventoryMovement) => (
                <TR key={movement.id}>
                  <TD className="whitespace-nowrap text-slate-500">
                    {new Date(movement.occurredAt).toLocaleString()}
                  </TD>
                  <TD>
                    <Badge tone="neutral">
                      {MOVEMENT_TYPE_LABELS[movement.movementType as MovementType] ?? movement.movementType}
                    </Badge>
                  </TD>
                  <TD className="text-slate-500">{index.locationName(movement.locationId)}</TD>
                  <TD className={`text-right font-medium ${movement.quantity < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                    {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                  </TD>
                  <TD className="text-right text-slate-500">{movement.balanceAfter}</TD>
                  <TD className="text-slate-500">
                    {movement.reason ?? (movement.referenceType ? `${movement.referenceType} ${shortId(movement.referenceId ?? '')}` : '—')}
                  </TD>
                  <TD className="text-slate-500">
                    {movement.actorType}
                    {movement.actorId ? ` · ${shortId(movement.actorId)}` : ''}
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
