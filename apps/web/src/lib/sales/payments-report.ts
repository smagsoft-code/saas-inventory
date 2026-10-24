import { serverApiFetch } from '../api/server';
import type { PaymentsReport } from '../types/payments-report';

/**
 * `GET /api/v1/reports/payments` (`sales.orders.view`). `dateFrom` is required — the page resolves
 * the default (today in the tenant timezone) before calling. Every other field is an optional
 * filter; the backend applies the caller's location/seller scope by itself.
 */
export interface PaymentsReportQuery {
  dateFrom: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  locationId?: string;
  warehouseId?: string;
  placedByUserId?: string;
  documentType?: string;
  paymentMethod?: string;
  orderNumber?: string;
  customerName?: string;
  sellerName?: string;
  amount?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
}

const KEYS = [
  'dateFrom',
  'dateTo',
  'locationId',
  'warehouseId',
  'placedByUserId',
  'documentType',
  'paymentMethod',
  'orderNumber',
  'customerName',
  'sellerName',
  'amount',
  'sort',
  'dir',
] as const;

function toParams(query: PaymentsReportQuery): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of KEYS) {
    const value = query[key];
    if (value) params[key] = value;
  }
  return params;
}

export async function getPaymentsReport(query: PaymentsReportQuery): Promise<PaymentsReport> {
  return serverApiFetch<PaymentsReport>('/api/v1/reports/payments', {
    query: { ...toParams(query), page: query.page ?? 1, pageSize: query.pageSize ?? 20 },
  });
}

export type PaymentsExportFormat = 'xlsx' | 'pdf';

/** Same-origin download link carrying exactly the filters on screen (no paging — the export
 * contains the whole filtered set, up to the backend's cap). */
export function buildPaymentsExportHref(query: PaymentsReportQuery, format: PaymentsExportFormat): string {
  return `/api/v1/reports/payments/export?${new URLSearchParams({ ...toParams(query), format })}`;
}
