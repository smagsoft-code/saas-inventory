import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { QrCode, QrTargetType } from '../types/qr';

/**
 * Server-side reads for QR codes (`GET /api/v1/qr-codes*`, permission `catalog.qr.manage`).
 * Create (`POST /qr-codes`) and revoke (`PATCH /qr-codes/:id`) go through `apiFetch` in the
 * relevant client component — the same read/write split every other F17 module uses.
 *
 * `ListQrCodesQueryDto` accepts `{ page, pageSize, targetType?, targetId? }` — no text search, no
 * sort, no status filter. Nothing else is added here.
 */
export interface ListQrCodesQuery {
  page?: number;
  pageSize?: number;
  targetType?: QrTargetType;
  targetId?: string;
}

export async function listQrCodes(query: ListQrCodesQuery = {}): Promise<Paginated<QrCode>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.targetType) {
    params['targetType'] = query.targetType;
  }
  if (query.targetId) {
    params['targetId'] = query.targetId;
  }
  return serverApiFetch<Paginated<QrCode>>('/api/v1/qr-codes', { query: params });
}

export async function getQrCode(id: string): Promise<QrCode> {
  return serverApiFetch<QrCode>(`/api/v1/qr-codes/${id}`);
}
