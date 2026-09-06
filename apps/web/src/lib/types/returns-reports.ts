/**
 * F18-04 — mirrors `GET /api/v1/reports/returns-summary`'s real response shape
 * (`apps/api/src/reports/returns/dto/returns-summary-response.dto.ts`), the same "no field is
 * added that the endpoint does not send" convention as `lib/types/reports.ts` (F18-02) — `apps/web`
 * does not import `@saas-inventory/types` at runtime.
 */

export const RETURNS_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'product', 'customer', 'disposition'] as const;
export type ReturnsSummaryGroupBy = (typeof RETURNS_SUMMARY_GROUP_BY)[number];

export const RETURNS_SUMMARY_GROUP_BY_LABELS: Record<ReturnsSummaryGroupBy, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  product: 'Product',
  customer: 'Customer',
  disposition: 'Disposition',
};

export interface ReturnsPeriodBucket {
  key: string;
  returnCount: number;
  orderCount: number;
  lineCount: number;
  quantity: number;
  returnedValue: number;
  avgReturnValue: number;
}

export interface ReturnsCustomerBucket {
  key: string;
  customerName: string;
  returnCount: number;
  orderCount: number;
  lineCount: number;
  quantity: number;
  returnedValue: number;
  avgReturnValue: number;
}

export interface ReturnsProductBucket {
  key: string;
  sku: string;
  productName: string;
  returnCount: number;
  orderCount: number;
  lineCount: number;
  quantity: number;
  returnedValue: number;
}

/** No `returnCount` — a single return can carry lines with more than one disposition (ADR-0021
 * fixes one disposition per *line*), so a return legitimately appears in more than one disposition
 * bucket. `lineCount`/`quantity`/`returnedValue` stay safe to sum across buckets. */
export interface ReturnsDispositionBucket {
  key: string;
  lineCount: number;
  quantity: number;
  returnedValue: number;
}

export type ReturnsSummaryBucket = ReturnsPeriodBucket | ReturnsCustomerBucket | ReturnsProductBucket | ReturnsDispositionBucket;

export interface ReturnsSummary {
  from: string;
  to: string;
  timezone: string;
  currency: string;
  groupBy: ReturnsSummaryGroupBy;
  buckets: ReturnsSummaryBucket[];
}

export function isReturnsProductBucket(bucket: ReturnsSummaryBucket): bucket is ReturnsProductBucket {
  return 'productName' in bucket;
}

export function isReturnsCustomerBucket(bucket: ReturnsSummaryBucket): bucket is ReturnsCustomerBucket {
  return 'customerName' in bucket;
}

export function isReturnsDispositionBucket(bucket: ReturnsSummaryBucket): bucket is ReturnsDispositionBucket {
  return !('returnCount' in bucket);
}
