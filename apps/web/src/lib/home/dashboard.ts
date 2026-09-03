import { isApiError } from '../api/errors';
import type { PermissionChecker } from '../auth/permissions';
import type { PermissionCode } from '../auth/permission-codes';
import { listOrders } from '../sales/orders';
import { listPriceApprovals } from '../sales/price-approvals';
import { listReturns } from '../sales/returns';
import { listTransfers } from '../inventory/transfers';
import { listImportJobs } from '../imports/imports';
import { listProducts } from '../catalog/products';
import { getTenantSettings } from '../tenant/tenant-settings';
import type { Paginated } from '../types/pagination';
import { tenantStartOfDayUtc } from './tenant-day';

/**
 * Data layer for the operational Home (F17-12 — `S-HOME`). Every number here comes from a **real,
 * audited** list endpoint's `meta.total`; nothing is computed from a downloaded list, no endpoint
 * is invented, no metric that the backend cannot answer is faked (`GAP-INV-AGGREGATE` low-stock,
 * revenue → deliberately absent; see `f17-gaps.md`).
 *
 * Fetching is separated from rendering (the page passes the resolved `HomeDashboard` to pure
 * components). Each tile is fetched **only** when the caller's permissions allow the underlying
 * request — a tile the user cannot see is `no-access` and the page omits it; it is never rendered
 * disabled and a 403 never becomes a page-level error. A single failing endpoint degrades **that
 * tile** to `unavailable` ("No disponible", never `0`); the rest of the Home still renders.
 *
 * Requests are independent and run with `Promise.all` — no N+1, no polling, no waterfall.
 */

export type TileState = 'ready' | 'unavailable' | 'no-access' | 'no-timezone';

export interface HomeQueueItem {
  id: string;
  href: string;
  primary: string;
  secondary?: string;
}

export interface HomeTile {
  key: string;
  label: string;
  /** "View all" target for this queue/metric. */
  href: string;
  /** Permission the underlying endpoint requires — for the quick-actions/legend, not gating. */
  state: TileState;
  /** Meaningful only when `state === 'ready'`. */
  count: number;
  /** Whether a non-zero count is something to act on (styles the number). */
  actionable: boolean;
  /** Top few rows for the "Needs attention" section. Empty for count-only tiles. */
  items: HomeQueueItem[];
  /** Short honest note for a degraded tile (e.g. the timezone limitation). */
  note?: string;
}

export interface HomeDashboard {
  tiles: HomeTile[];
}

const QUEUE_PREVIEW = 5;

interface Fetched<T> {
  state: TileState;
  count: number;
  items: T[];
}

/** Run a list read, mapping the outcome to a tile state. `can` short-circuits to `no-access` so we
 * never fire a request that is guaranteed to 403. */
async function fetchList<T>(
  can: boolean,
  fetcher: () => Promise<Paginated<T>>,
): Promise<Fetched<T>> {
  if (!can) {
    return { state: 'no-access', count: 0, items: [] };
  }
  try {
    const result = await fetcher();
    return { state: 'ready', count: result.meta.total, items: result.data };
  } catch (error) {
    if (isApiError(error) && error.status === 403) {
      return { state: 'no-access', count: 0, items: [] };
    }
    // 401/404/409/5xx/network — "could not be determined", distinct from a real zero.
    return { state: 'unavailable', count: 0, items: [] };
  }
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Loads every Home tile the caller may see. `now`/`checker` are the only inputs — pure enough to
 * unit test with the module helpers mocked. */
export async function loadHomeDashboard(
  checker: PermissionChecker,
  now: Date = new Date(),
): Promise<HomeDashboard> {
  const can = (code: PermissionCode): boolean => checker.can(code);
  const canApprovals = checker.canAny(['pricing.discount.request', 'pricing.discount.approve']);
  const canOrders = can('sales.orders.view');
  const canReturns = can('sales.returns.view');
  const canTransfers = can('inventory.view');
  const canImports = can('import.execute');
  const canProducts = can('products.view');

  // "Orders today" needs the tenant timezone, readable only with `administration.settings.view`
  // (Administrador in the default roles). GAP-TZ-VISIBILITY: F17-12 is frontend-only and cannot add
  // `timezone` to `GET /auth/me`, so for every other role this tile honestly degrades to
  // "no-timezone" rather than guessing a zone or using the browser's.
  const ordersTodayPromise: Promise<Fetched<unknown>> = (async () => {
    if (!canOrders) {
      return { state: 'no-access' as const, count: 0, items: [] };
    }
    const settings = await getTenantSettings();
    if (!settings) {
      return { state: 'no-timezone' as const, count: 0, items: [] };
    }
    const createdFrom = tenantStartOfDayUtc(settings.timezone, now);
    return fetchList(true, () =>
      listOrders({ status: 'confirmed', createdFrom, page: 1, pageSize: 1 }),
    );
  })();

  const [
    pendingOrders,
    ordersToday,
    pendingApprovals,
    returnsRequested,
    returnsInspecting,
    transfersDispatched,
    transfersPartial,
    importsFailed,
    importsWithErrors,
    draftProducts,
  ] = await Promise.all([
    fetchList(canOrders, () => listOrders({ status: 'pending', page: 1, pageSize: QUEUE_PREVIEW })),
    ordersTodayPromise,
    fetchList(canApprovals, () =>
      listPriceApprovals({ status: 'pending', page: 1, pageSize: QUEUE_PREVIEW }),
    ),
    fetchList(canReturns, () =>
      listReturns({ status: 'requested', page: 1, pageSize: QUEUE_PREVIEW }),
    ),
    fetchList(canReturns, () => listReturns({ status: 'inspecting', page: 1, pageSize: 1 })),
    fetchList(canTransfers, () =>
      listTransfers({ status: 'dispatched', page: 1, pageSize: QUEUE_PREVIEW }),
    ),
    fetchList(canTransfers, () =>
      listTransfers({ status: 'partially_received', page: 1, pageSize: 1 }),
    ),
    fetchList(canImports, () => listImportJobs({ status: 'failed', page: 1, pageSize: 1 })),
    fetchList(canImports, () =>
      listImportJobs({ status: 'completed_with_errors', page: 1, pageSize: QUEUE_PREVIEW }),
    ),
    fetchList(canProducts, () => listProducts({ status: 'draft', page: 1, pageSize: 1 })),
  ]);

  /** Combine a primary (list) status with a secondary count-only status — `GAP-MULTI-STATUS`: the
   * list DTOs take one `status`, so two parallel reads, never an invented `status=a,b`. If the
   * secondary read failed we still show the primary count (a documented possible undercount) rather
   * than blanking the whole tile. */
  function combined(
    primary: Fetched<{ id: string }>,
    secondary: Fetched<unknown>,
  ): { state: TileState; count: number; items: Fetched<{ id: string }>['items'] } {
    if (primary.state !== 'ready') {
      return { state: primary.state, count: 0, items: [] };
    }
    const extra = secondary.state === 'ready' ? secondary.count : 0;
    return { state: 'ready', count: primary.count + extra, items: primary.items };
  }

  const returns = combined(returnsRequested as Fetched<{ id: string }>, returnsInspecting);
  const transfers = combined(transfersDispatched as Fetched<{ id: string }>, transfersPartial);

  const tiles: HomeTile[] = [
    {
      key: 'pending-orders',
      label: 'Pending orders',
      href: '/sales?status=pending',
      state: pendingOrders.state,
      count: pendingOrders.count,
      actionable: true,
      items: (pendingOrders.items as { id: string; orderNumber: string; customer: { name: string } }[]).map(
        (o) => ({
          id: o.id,
          href: `/sales/${o.id}`,
          primary: o.orderNumber,
          secondary: o.customer?.name,
        }),
      ),
    },
    {
      key: 'orders-today',
      label: 'Orders confirmed today',
      href: '/sales?status=confirmed',
      state: ordersToday.state,
      count: ordersToday.count,
      actionable: false,
      items: [],
      ...(ordersToday.state === 'no-timezone'
        ? {
            note: 'Needs the company-settings permission to read the tenant timezone (GAP-TZ-VISIBILITY).',
          }
        : {}),
    },
    {
      key: 'pending-approvals',
      label: 'Price approvals pending',
      href: '/approvals?status=pending',
      state: pendingApprovals.state,
      count: pendingApprovals.count,
      actionable: true,
      items: (pendingApprovals.items as { id: string; reason: string }[]).map((a) => ({
        id: a.id,
        href: `/approvals/${a.id}`,
        primary: `Approval ${shortId(a.id)}`,
        secondary: a.reason,
      })),
    },
    {
      key: 'returns',
      label: 'Returns to process',
      href: '/returns',
      state: returns.state,
      count: returns.count,
      actionable: true,
      items: (returns.items as { id: string; reason: string }[]).map((r) => ({
        id: r.id,
        href: `/returns/${r.id}`,
        primary: `Return ${shortId(r.id)}`,
        secondary: r.reason,
      })),
    },
    {
      key: 'transfers',
      label: 'Transfers to receive',
      href: '/inventory/transfers?status=dispatched',
      state: transfers.state,
      count: transfers.count,
      actionable: true,
      items: (transfers.items as { id: string }[]).map((t) => ({
        id: t.id,
        href: `/inventory/transfers/${t.id}`,
        primary: `Transfer ${shortId(t.id)}`,
      })),
    },
    {
      key: 'imports',
      label: 'Imports needing attention',
      href: '/imports',
      // A failed read of either sub-status degrades the tile; both must be usable for a real count.
      state:
        importsFailed.state === 'ready' && importsWithErrors.state === 'ready'
          ? 'ready'
          : importsFailed.state === 'no-access'
            ? 'no-access'
            : 'unavailable',
      count: importsFailed.count + importsWithErrors.count,
      actionable: true,
      items: (importsWithErrors.items as { id: string; originalFilename: string }[]).map((j) => ({
        id: j.id,
        href: `/imports/${j.id}`,
        primary: j.originalFilename,
        secondary: 'Completed with errors',
      })),
    },
    {
      key: 'draft-products',
      label: 'Draft products',
      href: '/products?status=draft',
      state: draftProducts.state,
      count: draftProducts.count,
      actionable: false,
      items: [],
    },
  ];

  return { tiles };
}

/** Permission-gated shortcuts shown under the tiles. Pure — the page filters by the checker. */
export interface QuickAction {
  label: string;
  href: string;
  permission: PermissionCode;
}

export const HOME_QUICK_ACTIONS: readonly QuickAction[] = [
  { label: 'New sale', href: '/sales/new', permission: 'sales.orders.create' },
  { label: 'Adjust stock', href: '/inventory/adjust', permission: 'inventory.adjust' },
  { label: 'New transfer', href: '/inventory/transfers/new', permission: 'inventory.transfers.request' },
  { label: 'New product', href: '/products/new', permission: 'products.manage' },
  { label: 'Import catalog', href: '/imports/new', permission: 'import.execute' },
];
