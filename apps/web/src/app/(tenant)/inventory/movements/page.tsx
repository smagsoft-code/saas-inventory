import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listMovements } from '../../../../lib/inventory/movements';
import { buildLocationIndex, shortId } from '../../../../lib/inventory/location-index';
import {
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  type InventoryMovement,
  type MovementType,
} from '../../../../lib/types/inventory';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { NoAccess } from '../../../../components/ui/no-access';
import { Pagination } from '../../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

export const metadata = { title: 'Inventory movements · SaaS Inventory' };

const PAGE_SIZE = 20;

function parseMovementType(value: string | undefined): MovementType | undefined {
  return (MOVEMENT_TYPES as readonly string[]).includes(value ?? '') ? (value as MovementType) : undefined;
}

/**
 * Movement history / kardex (`S-INV-MOVEMENTS`) — `GET /api/v1/inventory/movements`
 * (`inventory.view`), offset paginated. Real filters only: `locationId`, `movementType` and (from
 * a drill-in) `productVariantId`. **No date range and no sort** (`GAP-MOVEMENTS-DATE-FILTER`) —
 * rows are shown in the order the endpoint returns them (newest first). FK ids only.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; locationId?: string; movementType?: string; productVariantId?: string }>;
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

  const [result, index] = await Promise.all([
    listMovements({
      page,
      pageSize: PAGE_SIZE,
      ...(locationId ? { locationId } : {}),
      ...(movementType ? { movementType } : {}),
      ...(productVariantId ? { productVariantId } : {}),
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
  }): string {
    const params = new URLSearchParams();
    const nextLocation = 'locationId' in next ? next.locationId : locationId;
    const nextType = 'movementType' in next ? next.movementType : movementType;
    const nextVariant = 'productVariantId' in next ? next.productVariantId : productVariantId;
    if (nextLocation) params.set('locationId', nextLocation);
    if (nextType) params.set('movementType', nextType);
    if (nextVariant) params.set('productVariantId', nextVariant);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/inventory/movements${params.toString() ? `?${params}` : ''}`;
  }

  const chip = (active: boolean) =>
    active
      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  const hasFilter = Boolean(locationId || movementType || productVariantId);

  return (
    <PageContainer>
      <PageHeader
        title="Inventory movements"
        description="The append-only stock ledger: every receipt, sale, transfer, reservation and adjustment."
      />

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
          description={hasFilter ? 'Try a different location or type.' : 'Movements appear here as stock changes.'}
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
