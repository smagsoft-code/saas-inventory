/**
 * F18-02 — mirrors `GET /api/v1/reports/sales-summary`'s real response shape
 * (`apps/api/src/reports/sales/dto/sales-summary-response.dto.ts`), the same "no field is added
 * that the endpoint does not send" convention as `lib/types/session.ts` (F18-01) — `apps/web` does
 * not import `@saas-inventory/types` at runtime, so `ReportResult<T>`/`ReportBucket` are mirrored
 * here rather than imported.
 */

export const SALES_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'product', 'customer'] as const;
export type SalesSummaryGroupBy = (typeof SALES_SUMMARY_GROUP_BY)[number];

export const SALES_SUMMARY_GROUP_BY_LABELS: Record<SalesSummaryGroupBy, string> = {
  day: 'Día',
  week: 'Semana',
  month: 'Mes',
  product: 'Producto',
  customer: 'Cliente',
};

/** F18-06 — the `exceptional` filter (`GAP-EXCEPTIONAL-FILTER`). Mirrors
 * `SALES_SUMMARY_EXCEPTIONAL` in `apps/api/.../sales-summary-query.dto.ts`. `all` = no filter. */
export const SALES_SUMMARY_EXCEPTIONAL = ['all', 'only', 'exclude'] as const;
export type SalesSummaryExceptional = (typeof SALES_SUMMARY_EXCEPTIONAL)[number];

export const SALES_SUMMARY_EXCEPTIONAL_LABELS: Record<SalesSummaryExceptional, string> = {
  all: 'Todas las ventas',
  only: 'Solo descuento excepcional',
  exclude: 'Excluir excepcionales',
};

export interface SalesPeriodBucket {
  key: string;
  orderCount: number;
  subtotal: number;
  discountTotal: number;
  total: number;
  avgTicket: number;
  /** Frozen cost of the bucket's sold lines. Present only for callers with `pricing.cost.view`
   * (ADR-0028) — absent otherwise, never a masked 0. Period groupings only. */
  costTotal?: number;
  /** `total − costTotal`; present only alongside `costTotal`. */
  profit?: number;
  /** Sold lines with no cost snapshot (counted as 0 in `costTotal`); present only alongside it. */
  missingCostLines?: number;
}

export interface SalesCustomerBucket {
  key: string;
  customerName: string;
  orderCount: number;
  subtotal: number;
  discountTotal: number;
  total: number;
  avgTicket: number;
}

export interface SalesProductBucket {
  key: string;
  sku: string;
  productName: string;
  orderCount: number;
  quantity: number;
  discountTotal: number;
  total: number;
}

export type SalesSummaryBucket = SalesPeriodBucket | SalesCustomerBucket | SalesProductBucket;

export interface SalesSummary {
  from: string;
  to: string;
  timezone: string;
  currency: string;
  groupBy: SalesSummaryGroupBy;
  exceptional: SalesSummaryExceptional;
  buckets: SalesSummaryBucket[];
}

export function isProductBucket(bucket: SalesSummaryBucket): bucket is SalesProductBucket {
  return 'productName' in bucket;
}

export function isCustomerBucket(bucket: SalesSummaryBucket): bucket is SalesCustomerBucket {
  return 'customerName' in bucket;
}
