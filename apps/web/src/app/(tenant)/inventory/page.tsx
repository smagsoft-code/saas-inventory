import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listBalances } from '../../../lib/inventory/balances';
import { buildLocationIndex, shortId } from '../../../lib/inventory/location-index';
import type { InventoryBalance } from '../../../lib/types/inventory';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Stock on hand · SaaS Inventory' };

const PAGE_SIZE = 20;

/**
 * Stock on hand (`S-INV-BALANCES`) — `GET /api/v1/inventory/balances` (`inventory.view`), offset
 * paginated. Real filters only: `locationId` and (when drilled in from a variant) `productVariantId`
 * — no warehouse / product / status / search / sort (`GAP-NAME-ENRICHMENT` / `GAP-INV-AGGREGATE`).
 * The endpoint returns FK ids only; location/warehouse names come from one bounded lookup, the
 * variant id is shown as a short code (no tenant-wide variant list — `GAP-VARIANT-LIST`).
 */
export default async function InventoryBalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; locationId?: string; productVariantId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Stock on hand" />
        <NoAccess message="You need the inventory permission to view this page." />
      </PageContainer>
    );
  }
  const canAdjust = checker.can('inventory.adjust');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const locationId = sp.locationId || undefined;
  const productVariantId = sp.productVariantId || undefined;

  const [result, index] = await Promise.all([
    listBalances({
      page,
      pageSize: PAGE_SIZE,
      ...(locationId ? { locationId } : {}),
      ...(productVariantId ? { productVariantId } : {}),
    }),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);
  // Reuse the index's own location fetch for the filter chips — no second GET /locations.
  const locationChips = index.locations.filter((l) => l.status === 'active');

  function buildHref(next: { page?: number; locationId?: string | undefined; productVariantId?: string | undefined }): string {
    const params = new URLSearchParams();
    const nextLocation = 'locationId' in next ? next.locationId : locationId;
    const nextVariant = 'productVariantId' in next ? next.productVariantId : productVariantId;
    if (nextLocation) params.set('locationId', nextLocation);
    if (nextVariant) params.set('productVariantId', nextVariant);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/inventory${params.toString() ? `?${params}` : ''}`;
  }

  const adjustHref = productVariantId
    ? `/inventory/adjust?productVariantId=${productVariantId}`
    : '/inventory/adjust';

  return (
    <PageContainer>
      <PageHeader
        title="Stock on hand"
        description="Physical, reserved, committed and available quantity per variant and location."
        actions={canAdjust ? <ButtonLink href={adjustHref}>Adjust stock</ButtonLink> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        {productVariantId && (
          <Link
            href={buildHref({ productVariantId: undefined })}
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Variant {shortId(productVariantId)} <span aria-hidden="true">×</span>
            <span className="sr-only">Clear variant filter</span>
          </Link>
        )}
        {locationChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ locationId: undefined })}
              aria-current={!locationId ? 'true' : undefined}
              className={
                !locationId
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
              }
            >
              All locations
            </Link>
            {locationChips.map((location) => {
              const active = locationId === location.id;
              return (
                <Link
                  key={location.id}
                  href={buildHref({ locationId: location.id })}
                  aria-current={active ? 'true' : undefined}
                  className={
                    active
                      ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
                  }
                >
                  {location.name}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={locationId || productVariantId ? 'No stock matches this filter' : 'No stock recorded yet'}
          description={
            locationId || productVariantId
              ? 'Try a different location, or clear the filter.'
              : 'Stock appears here after a receipt, adjustment or transfer.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Variant</TH>
                <TH>Location</TH>
                <TH>Warehouse</TH>
                <TH className="text-right">Available</TH>
                <TH className="text-right">Reserved</TH>
                <TH className="text-right">Committed</TH>
                <TH className="text-right">Physical</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((balance: InventoryBalance) => (
                <TR key={balance.id}>
                  <TD>
                    <code className="text-xs text-slate-500">{shortId(balance.productVariantId)}</code>
                  </TD>
                  <TD className="text-slate-700">{index.locationName(balance.locationId)}</TD>
                  <TD className="text-slate-500">{index.warehouseName(balance.locationId)}</TD>
                  <TD className="text-right font-medium">
                    {balance.quantityAvailable}
                    {balance.quantityAvailable <= 0 && (
                      <Badge tone="danger" className="ml-2">
                        out
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-right text-slate-500">{balance.quantityReserved}</TD>
                  <TD className="text-right text-slate-500">{balance.quantityCommitted}</TD>
                  <TD className="text-right text-slate-500">{balance.quantityPhysical}</TD>
                  <TD>
                    <Link
                      href={`/inventory/${balance.id}`}
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      Detail
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
