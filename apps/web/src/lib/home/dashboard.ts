import { isApiError } from '../api/errors';
import type { PermissionChecker } from '../auth/permissions';
import { getSalesSummary } from '../sales/reports';
import { getInventorySummary, getTransfersSummary } from '../inventory/reports';
import { listLocations } from '../inventory/locations';
import { isTransferDestinationBucket, type TransfersSummary } from '../types/inventory-reports';
import type { SalesPeriodBucket, SalesProductBucket } from '../types/reports';
import { tenantStartOfDayUtc } from './tenant-day';

/**
 * Data layer for the operational Home (OUI-002 — replaces the F17-12 queue-based dashboard with
 * the five cards the owner asked for: today's sales, available stock, inventory value, transfers
 * in transit, and today's top-10 sellers). Every number still comes from a **real, audited**
 * report endpoint; nothing is folded from a downloaded list, no endpoint is invented, no metric
 * the backend cannot answer is faked. A single failing endpoint degrades **that tile** to
 * `unavailable` ("No disponible", never `0`); the rest of the Home still renders. No chart —
 * every card is the same plain KPI-card shape the page already used.
 *
 * The Almacén filter at the top (`locationId`) narrows every card at once:
 *  - Sales day/top-10 — `orders.location_id` equality filter (OUI-002 backend addition).
 *  - Available stock / inventory value — `inventory_balances.location_id` equality filter
 *    (OUI-002 backend addition, the finer-grained sibling of the existing `warehouseId` filter).
 *  - Transfers in transit — no backend filter exists for this snapshot; narrowed **client-side**
 *    by matching the `groupBy=destination` bucket whose key is the selected location, which the
 *    endpoint already resolves server-side (F18-08) — no new endpoint, no fabricated number.
 */

export type TileState = 'ready' | 'unavailable' | 'no-access';
export type TileFormat = 'currency' | 'count';

export interface HomeTile {
  key: string;
  label: string;
  /** "View all" target for this metric. */
  href: string;
  state: TileState;
  /** Meaningful only when `state === 'ready'`. */
  value: number;
  format: TileFormat;
  /** Only ever set alongside `format: 'currency'`, and only when a real currency code was
   * available (sales-summary) — never guessed. `undefined` renders the plain number. */
  currency?: string;
  /** Short honest note for a degraded or partial tile (e.g. costs missing on some variants). */
  note?: string;
}

export interface HomeTopProduct {
  variantId: string;
  sku: string;
  productName: string;
  quantity: number;
}

export interface HomeTopProductsCard {
  state: TileState;
  items: HomeTopProduct[];
}

export interface HomeLocationOption {
  id: string;
  name: string;
}

export interface HomeDashboard {
  tiles: HomeTile[];
  topProducts: HomeTopProductsCard;
  /** Active locations (Almacenes) for the filter selector — empty when the caller cannot list
   * them or the tenant has none; the page hides the filter in that case. */
  locationOptions: HomeLocationOption[];
  /** The filter actually applied — `undefined` when omitted, or when the requested id matched no
   * real location (never silently "applied" against a bogus id). */
  selectedLocationId?: string;
}

const TOP_PRODUCTS_LIMIT = 10;

interface Fetched<T> {
  state: TileState;
  value: T | null;
}

/** Run one report read, mapping the outcome to a tile state. `can` short-circuits to `no-access`
 * so we never fire a request that is guaranteed to 403. */
async function fetchValue<T>(can: boolean, fetcher: () => Promise<T>): Promise<Fetched<T>> {
  if (!can) {
    return { state: 'no-access', value: null };
  }
  try {
    return { state: 'ready', value: await fetcher() };
  } catch (error) {
    if (isApiError(error) && error.status === 403) {
      return { state: 'no-access', value: null };
    }
    // 401/404/409/5xx/network — "could not be determined", distinct from a real zero.
    return { state: 'unavailable', value: null };
  }
}

/** Loads every Home card the caller may see, narrowed to `locationId` when given. `timezone` is
 * the active tenant's IANA zone (F18-01, `session.timezone`); `now`/`checker` are the other
 * inputs — pure enough to unit test with the module helpers mocked. */
export async function loadHomeDashboard(
  checker: PermissionChecker,
  timezone: string,
  locationId?: string,
  now: Date = new Date(),
): Promise<HomeDashboard> {
  const canSales = checker.can('sales.orders.view');
  const canInventory = checker.can('inventory.view');
  const canViewCost = checker.can('pricing.cost.view');
  const canLocations = checker.can('locations.view');

  const from = tenantStartOfDayUtc(timezone, now);
  const to = now.toISOString();

  // Locations resolve first (a small, bounded list) so a bogus/stale `locationId` can be caught
  // *before* it is ever sent to a report endpoint — never a wasted request against an id that
  // matches nothing, and never a filter that silently "applies" against garbage.
  const locationsPage = await fetchValue(canLocations, () => listLocations({ status: 'active', pageSize: 100 }));
  const locationOptions: HomeLocationOption[] = (locationsPage.value?.data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
  }));
  const selectedLocationId =
    locationId && locationOptions.some((l) => l.id === locationId) ? locationId : undefined;

  const [salesDay, salesByProduct, inventorySummary, transfersSummary] = await Promise.all([
    fetchValue(canSales, () => getSalesSummary({ from, to, groupBy: 'day', ...(selectedLocationId ? { locationId: selectedLocationId } : {}) })),
    fetchValue(canSales, () => getSalesSummary({ from, to, groupBy: 'product', ...(selectedLocationId ? { locationId: selectedLocationId } : {}) })),
    fetchValue(canInventory, () => getInventorySummary({ groupBy: 'warehouse', ...(selectedLocationId ? { locationId: selectedLocationId } : {}) })),
    fetchValue(canInventory, () => getTransfersSummary({ groupBy: 'destination' })),
  ]);

  // A single-currency-per-tenant app (FASE 12 default) — the code itself always comes from a real
  // response (sales-summary), never assumed; the inventory-value tile borrows it only when it is
  // actually known, otherwise it renders a plain number rather than guessing a currency.
  const currency = salesDay.value?.currency;

  const salesTotal = (salesDay.value?.buckets[0] as SalesPeriodBucket | undefined)?.total ?? 0;

  const missingCostCount = inventorySummary.value?.totals.missingCostCount ?? 0;
  const inventoryValueState: TileState = !canViewCost ? 'no-access' : inventorySummary.state;

  const transfers = resolveTransfersTile(transfersSummary, selectedLocationId);

  const tiles: HomeTile[] = [
    {
      key: 'sales-today',
      label: 'Ventas del día',
      href: '/sales',
      state: salesDay.state,
      value: salesTotal,
      format: 'currency',
      ...(currency ? { currency } : {}),
    },
    {
      key: 'available-products',
      label: 'Productos disponibles',
      href: '/inventory',
      state: inventorySummary.state,
      value: inventorySummary.value?.totals.availableQuantity ?? 0,
      format: 'count',
    },
    {
      key: 'inventory-value',
      label: 'Valor total de inventario',
      href: '/inventory',
      state: inventoryValueState,
      value: inventorySummary.value?.totals.totalCostValue ?? 0,
      format: 'currency',
      ...(currency ? { currency } : {}),
      ...(inventoryValueState === 'ready' && missingCostCount > 0
        ? { note: `${missingCostCount} variante(s) sin costo cargado, excluida(s) del total.` }
        : {}),
    },
    {
      key: 'transfers-in-transit',
      label: 'Transferencias en tránsito',
      href: '/inventory/transfers?status=dispatched',
      state: transfers.state,
      value: transfers.count,
      format: 'count',
      ...(transfers.note ? { note: transfers.note } : {}),
    },
  ];

  const topProducts: HomeTopProductsCard = {
    state: salesByProduct.state,
    items: [...(salesByProduct.value?.buckets ?? [])]
      .map((b) => b as SalesProductBucket)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, TOP_PRODUCTS_LIMIT)
      .map((b) => ({ variantId: b.key, sku: b.sku, productName: b.productName, quantity: b.quantity })),
  };

  return { tiles, topProducts, locationOptions, ...(selectedLocationId ? { selectedLocationId } : {}) };
}

/** `transfers-summary` has no location filter of its own (F18-08 is a tenant-wide snapshot) — this
 * narrows client-side to the one `groupBy=destination` bucket the endpoint already resolved for
 * the selected Almacén. No bucket for that location is a real, honest zero ("nothing currently
 * heading there"), never treated as `unavailable`. */
function resolveTransfersTile(
  transfersSummary: Fetched<TransfersSummary>,
  selectedLocationId: string | undefined,
): { state: TileState; count: number; note?: string } {
  if (transfersSummary.state !== 'ready' || !transfersSummary.value) {
    return { state: transfersSummary.state, count: 0 };
  }
  if (!selectedLocationId) {
    const { openTransferCount, inTransitQuantity } = transfersSummary.value.totals;
    return {
      state: 'ready',
      count: openTransferCount,
      ...(inTransitQuantity > 0 ? { note: `${inTransitQuantity} unidad(es) en tránsito.` } : {}),
    };
  }
  const bucket = transfersSummary.value.buckets
    .filter(isTransferDestinationBucket)
    .find((b) => b.key === selectedLocationId);
  if (!bucket) {
    return { state: 'ready', count: 0 };
  }
  return {
    state: 'ready',
    count: bucket.openTransferCount,
    ...(bucket.inTransitQuantity > 0 ? { note: `${bucket.inTransitQuantity} unidad(es) en tránsito.` } : {}),
  };
}
