import { isApiError } from '../api/errors';
import type { PermissionChecker } from '../auth/permissions';
import { getSalesSummary } from '../sales/reports';
import { getInventorySummary } from '../inventory/reports';
import { listLocations } from '../inventory/locations';
import { listWarehouses } from '../inventory/warehouses';
import { getLocationScope } from '../inventory/location-scope';
import { listProductCatalog } from '../catalog/product-catalog';
import type { SalesPeriodBucket, SalesProductBucket } from '../types/reports';
import { tenantDateParts, tenantStartOfDayUtc, tenantStartOfYearUtc } from './tenant-day';

/**
 * Data layer for the operational Home. Every number comes from a **real, audited** endpoint —
 * nothing is folded from a downloaded list, no endpoint is invented, no metric the backend cannot
 * answer is faked. A single failing endpoint degrades **that card** to `unavailable` ("No
 * disponible", never `0`); the rest of the Home still renders.
 *
 * Two rows of cards (same layout the owner asked for):
 *  - KPI row — Total productos · Valor total de inventario · Costo neto del mes (with the month's
 *    ganancia).
 *  - Highlight row — Ventas de hoy · Ventas del mes (blue) · Ventas del año.
 * Sales come from two `sales-summary` reads: today (`groupBy=day`) and the whole year to date
 * (`groupBy=month`) — the current month is that read's last bucket, the year is the sum of its
 * buckets, all in the tenant's own timezone. Cost/profit exist only for callers holding
 * `pricing.cost.view` (ADR-0028) — the endpoint omits them otherwise, and so does this page.
 *
 * "Total productos" is the very number the Productos screen lists by default: **active catalog
 * rows** (`GET /reports/product-catalog?status=active` — one row per code/variant), never the
 * `products.status` count: a product header and its variants have separate statuses, so counting
 * product headers by status can differ from what the Productos screen shows.
 *
 * The Almacén filter (top-right, level with the welcome message) narrows sales, stock alerts and
 * inventory value, and only offers the locations the user is actually authorized for
 * (`GET /inventory/location-scope`, ADR-0024/0035 — the founding Administrador sees them all).
 * "Total productos" follows it too: with an Almacén chosen it counts the active products (codes) that
 * have stock available there (`product-catalog?locationId=…&stock=available`); with "Todos los
 * almacenes" it stays the catalog size the Productos screen lists.
 */

export type TileState = 'ready' | 'unavailable' | 'no-access';
export type TileFormat = 'currency' | 'count';
export type HomeIcon = 'box' | 'alert' | 'dollar' | 'cart' | 'doc' | 'trend';

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
  /** Secondary line under the value (e.g. the month's ganancia). */
  sub?: string;
  icon?: HomeIcon;
  /** Colour family of the icon badge. */
  tone?: 'indigo' | 'rose' | 'emerald' | 'sky' | 'amber';
}

export interface HomeHighlight {
  key: string;
  label: string;
  href: string;
  state: TileState;
  value: number;
  currency?: string;
  accent: 'emerald' | 'indigo' | 'orange';
}

/** One calendar month of the trend chart (`month` 1–12). `null` = no data (a month of the current
 * year that has not happened yet), never a fake zero. `cost` is `null` when the caller cannot see costs. */
export interface HomeTrendPoint {
  month: number;
  sales: number | null;
  cost: number | null;
}

/** "Tendencia de ventas": 12 monthly points of one calendar year (tenant timezone). */
export interface HomeSalesTrend {
  state: TileState;
  year: number;
  /** Years offered by the year picker (newest first). */
  years: number[];
  currency?: string | undefined;
  /** Whether a "Costo neto" series exists (needs `pricing.cost.view`). */
  hasCost: boolean;
  points: HomeTrendPoint[];
}

const TREND_YEARS_BACK = 4;

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
  /** "Sucursal · Almacén" when the sucursal name is known, otherwise just the almacén. */
  name: string;
}

export interface HomeDashboard {
  tiles: HomeTile[];
  highlights: HomeHighlight[];
  trend: HomeSalesTrend;
  topProducts: HomeTopProductsCard;
  /** The active locations (Almacenes) **this user may operate on** — empty when they cannot be
   * resolved or there are none; the page hides the filter in that case. */
  locationOptions: HomeLocationOption[];
  /** The filter actually applied — `undefined` when omitted, or when the requested id is not one
   * of `locationOptions` (never silently "applied" against an id the user may not use). */
  selectedLocationId?: string;
}

const TOP_PRODUCTS_LIMIT = 10;

interface Fetched<T> {
  state: TileState;
  value: T | null;
}

/** Run one read, mapping the outcome to a tile state. `can` short-circuits to `no-access` so we
 * never fire a request that is guaranteed to 403. */
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

function monthName(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('es', { month: 'long', timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(now);
  }
}

/** The location options this user may use: active locations ∩ their operating scope. */
async function resolveLocationOptions(checker: PermissionChecker): Promise<HomeLocationOption[]> {
  const [scope, locationsPage, warehousesPage] = await Promise.all([
    fetchValue(true, () => getLocationScope()),
    fetchValue(checker.can('locations.view'), () => listLocations({ status: 'active', pageSize: 100 })),
    fetchValue(checker.can('warehouses.view'), () => listWarehouses({ pageSize: 100 })),
  ]);
  // No proven scope → no options (never fall back to "every location").
  if (scope.state !== 'ready' || !scope.value) {
    return [];
  }
  const allowed = scope.value.unrestricted ? null : new Set(scope.value.locationIds);
  const warehouseNames = new Map((warehousesPage.value?.data ?? []).map((w) => [w.id, w.name]));
  return (locationsPage.value?.data ?? [])
    .filter((l) => allowed === null || allowed.has(l.id))
    .map((l) => {
      const warehouse = warehouseNames.get(l.warehouseId);
      return { id: l.id, name: warehouse ? `${warehouse} · ${l.name}` : l.name };
    });
}

/** Loads every Home card the caller may see, narrowed to `locationId` when given. `timezone` is
 * the active tenant's IANA zone (F18-01, `session.timezone`). */
export async function loadHomeDashboard(
  checker: PermissionChecker,
  timezone: string,
  locationId?: string,
  now: Date = new Date(),
  chartYear?: number,
): Promise<HomeDashboard> {
  const canSales = checker.can('sales.orders.view');
  const canInventory = checker.can('inventory.view');
  const canViewCost = checker.can('pricing.cost.view');
  const canProducts = checker.can('products.view');

  const dayFrom = tenantStartOfDayUtc(timezone, now);
  const yearFrom = tenantStartOfYearUtc(timezone, now);
  const to = now.toISOString();

  // Locations resolve first so a bogus / unauthorized `locationId` is dropped *before* it is sent to
  // a report endpoint.
  const locationOptions = await resolveLocationOptions(checker);
  const selectedLocationId = locationId && locationOptions.some((l) => l.id === locationId) ? locationId : undefined;
  const loc = selectedLocationId ? { locationId: selectedLocationId } : {};

  const [salesToday, salesYear, salesByProduct, inventorySummary, productsPage] = await Promise.all([
    fetchValue(canSales, () => getSalesSummary({ from: dayFrom, to, groupBy: 'day', ...loc })),
    fetchValue(canSales, () => getSalesSummary({ from: yearFrom, to, groupBy: 'month', ...loc })),
    fetchValue(canSales, () => getSalesSummary({ from: dayFrom, to, groupBy: 'product', ...loc })),
    fetchValue(canInventory, () => getInventorySummary({ groupBy: 'warehouse', ...loc })),
    // With an Almacén chosen the tile counts the active products that have stock there; with none
    // it stays the catalog size the Productos screen lists.
    fetchValue(canProducts, () => listProductCatalog({ status: 'active', pageSize: 1, ...(selectedLocationId ? { locationId: selectedLocationId, stock: 'available' as const } : {}) })),
  ]);

  // A single-currency-per-tenant app (FASE 12 default) — the code itself always comes from a real
  // response (sales-summary), never assumed.
  const currency = salesToday.value?.currency ?? salesYear.value?.currency;
  const currencyProp = currency ? { currency } : {};

  const todayTotal = (salesToday.value?.buckets[0] as SalesPeriodBucket | undefined)?.total ?? 0;

  const { year, month } = tenantDateParts(timezone, now);
  const monthKey = `${year}-${String(month).padStart(2, '0')}-01`;
  const yearBuckets = (salesYear.value?.buckets ?? []) as SalesPeriodBucket[];
  const monthBucket = yearBuckets.find((b) => b.key === monthKey);
  const monthTotal = monthBucket?.total ?? 0;
  const yearTotal = yearBuckets.reduce((sum, b) => sum + b.total, 0);
  const monthLabel = monthName(timezone, now);

  const missingCostCount = inventorySummary.value?.totals.missingCostCount ?? 0;
  const inventoryValueState: TileState = !canViewCost ? 'no-access' : inventorySummary.state;

  // Cost/profit are present on the month bucket only for pricing.cost.view holders; a month with no
  // orders legitimately has no bucket (real zero).
  const costState: TileState = !canViewCost ? 'no-access' : salesYear.state;
  const monthCost = monthBucket?.costTotal ?? 0;
  const monthProfit = monthBucket?.profit ?? 0;
  const monthMissingCostLines = monthBucket?.missingCostLines ?? 0;

  const money = (value: number): string =>
    new Intl.NumberFormat('es-EC', { style: 'currency', currency: currency ?? 'USD' }).format(value);

  const tiles: HomeTile[] = [
    {
      key: 'total-products',
      label: 'Total productos',
      href: '/products',
      state: productsPage.state,
      value: productsPage.value?.meta.total ?? 0,
      format: 'count',
      icon: 'box',
      tone: 'indigo',
      ...(selectedLocationId ? { note: 'Con existencias en este almacén' } : {}),
    },
    {
      key: 'inventory-value',
      label: 'Valor total de inventario',
      href: '/inventory',
      state: inventoryValueState,
      value: inventorySummary.value?.totals.totalCostValue ?? 0,
      format: 'currency',
      icon: 'dollar',
      tone: 'emerald',
      ...currencyProp,
      ...(inventoryValueState === 'ready' && missingCostCount > 0
        ? { note: `${missingCostCount} variante(s) sin costo cargado, excluida(s) del total.` }
        : {}),
    },
    {
      key: 'net-cost-month',
      label: `Costo neto (${monthLabel})`,
      href: '/sales',
      state: costState,
      value: monthCost,
      format: 'currency',
      icon: 'doc',
      tone: 'amber',
      ...currencyProp,
      ...(costState === 'ready' ? { sub: `Ganancia: ${money(monthProfit)}` } : {}),
      ...(costState === 'ready' && monthMissingCostLines > 0
        ? { note: `${monthMissingCostLines} línea(s) vendida(s) sin costo registrado.` }
        : {}),
    },
  ];

  const highlights: HomeHighlight[] = [
    { key: 'sales-today', label: 'Ventas de hoy', href: '/sales', state: salesToday.state, value: todayTotal, accent: 'emerald', ...currencyProp },
    { key: 'sales-month', label: `Ventas de ${monthLabel}`, href: '/sales', state: salesYear.state, value: monthTotal, accent: 'indigo', ...currencyProp },
    { key: 'sales-year', label: `Ventas del ${year}`, href: '/sales', state: salesYear.state, value: yearTotal, accent: 'orange', ...currencyProp },
  ];

  // Tendencia de ventas — the selected calendar year (default: the current one, whose data is the
  // year-to-date read already made above; any other year needs its own read).
  const selectedYear = chartYear !== undefined && chartYear >= year - TREND_YEARS_BACK && chartYear <= year ? chartYear : year;
  const yearStart = (y: number): string => tenantStartOfYearUtc(timezone, new Date(Date.UTC(y, 5, 15)));
  const trendSummary =
    selectedYear === year
      ? salesYear
      : await fetchValue(canSales, () => getSalesSummary({ from: yearStart(selectedYear), to: yearStart(selectedYear + 1), groupBy: 'month', ...loc }));
  const trendBuckets = (trendSummary.value?.buckets ?? []) as SalesPeriodBucket[];
  const trend: HomeSalesTrend = {
    state: trendSummary.state,
    year: selectedYear,
    years: Array.from({ length: TREND_YEARS_BACK + 1 }, (_, i) => year - i),
    ...(currency ? { currency } : {}),
    hasCost: canViewCost,
    points: Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      // A month of the current year that has not started yet has no data at all.
      const future = selectedYear === year && month > tenantDateParts(timezone, now).month;
      const bucket = trendBuckets.find((b) => b.key === `${selectedYear}-${String(month).padStart(2, '0')}-01`);
      return {
        month,
        sales: future ? null : (bucket?.total ?? 0),
        cost: future || !canViewCost ? null : (bucket?.costTotal ?? 0),
      };
    }),
  };

  const topProducts: HomeTopProductsCard = {
    state: salesByProduct.state,
    items: [...(salesByProduct.value?.buckets ?? [])]
      .map((b) => b as SalesProductBucket)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, TOP_PRODUCTS_LIMIT)
      .map((b) => ({ variantId: b.key, sku: b.sku, productName: b.productName, quantity: b.quantity })),
  };

  return { tiles, highlights, trend, topProducts, locationOptions, ...(selectedLocationId ? { selectedLocationId } : {}) };
}
