/**
 * F18-05 — mirrors `GET /api/v1/reports/approvals-summary`'s real response shape
 * (`apps/api/src/reports/approvals/dto/approvals-summary-response.dto.ts`), the same "no field is
 * added that the endpoint does not send" convention as `lib/types/reports.ts` (F18-02) /
 * `lib/types/returns-reports.ts` (F18-04) — `apps/web` does not import `@saas-inventory/types` at
 * runtime.
 */

export const APPROVALS_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'status'] as const;
export type ApprovalsSummaryGroupBy = (typeof APPROVALS_SUMMARY_GROUP_BY)[number];

export const APPROVALS_SUMMARY_GROUP_BY_LABELS: Record<ApprovalsSummaryGroupBy, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  status: 'Status',
};

export const APPROVALS_SUMMARY_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ApprovalsSummaryStatus = (typeof APPROVALS_SUMMARY_STATUSES)[number];

/** A request-cohort bucket: the requests *filed* in the period, with counts reflecting their
 * current status. `requestCount` equals the sum of the four status counts. */
export interface ApprovalsPeriodBucket {
  key: string;
  requestCount: number;
  approvedCount: number;
  rejectedCount: number;
  cancelledCount: number;
  pendingCount: number;
  approvedDiscountValue: number;
  /** approvedCount / (approvedCount + rejectedCount); null when nothing decided yet. */
  approvalRate: number | null;
}

export interface ApprovalsStatusBucket {
  key: string;
  requestCount: number;
  discountValue: number;
}

export type ApprovalsSummaryBucket = ApprovalsPeriodBucket | ApprovalsStatusBucket;

export interface ApprovalsSummary {
  from: string;
  to: string;
  timezone: string;
  currency: string;
  groupBy: ApprovalsSummaryGroupBy;
  buckets: ApprovalsSummaryBucket[];
}

export function isApprovalsStatusBucket(bucket: ApprovalsSummaryBucket): bucket is ApprovalsStatusBucket {
  return 'discountValue' in bucket;
}
