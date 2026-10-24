import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { Transfer, TransferStatus } from '../types/inventory';

/**
 * Server-side reads for inventory transfers (`GET /api/v1/inventory/transfers*`, permission
 * `inventory.view`). Lifecycle mutations (`approve`/`prepare`/`dispatch`/`receive`/`cancel`) and
 * `POST /inventory/transfers` go through `apiFetch` directly in the client components — the same
 * read/write split F17-04/F17-05/F17-06 use.
 *
 * `ListTransfersQueryDto` accepts a **single** `status` (`GAP-MULTI-STATUS`), `sourceLocationId`
 * and `destinationLocationId` — no `q`, no `sort`, no date range. Nothing else is added here.
 * The response is FK ids only (`GAP-NAME-ENRICHMENT`); names come from the shared
 * `buildLocationIndex()`.
 */
export interface ListTransfersQuery {
  page?: number;
  pageSize?: number;
  status?: TransferStatus;
  sourceLocationId?: string;
  destinationLocationId?: string;
  /** ISO instants, half-open [createdFrom, createdTo) on created_at. */
  createdFrom?: string;
  createdTo?: string;
}

export async function listTransfers(query: ListTransfersQuery = {}): Promise<Paginated<Transfer>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  if (query.sourceLocationId) {
    params['sourceLocationId'] = query.sourceLocationId;
  }
  if (query.destinationLocationId) {
    params['destinationLocationId'] = query.destinationLocationId;
  }
  if (query.createdFrom) {
    params['createdFrom'] = query.createdFrom;
  }
  if (query.createdTo) {
    params['createdTo'] = query.createdTo;
  }
  return serverApiFetch<Paginated<Transfer>>('/api/v1/inventory/transfers', { query: params });
}

/** Same-origin Excel/PDF download of the filtered transfer list — the whole filtered set. */
export function buildTransfersExportHref(query: Pick<ListTransfersQuery, 'status' | 'sourceLocationId' | 'destinationLocationId' | 'createdFrom' | 'createdTo'>, format: 'xlsx' | 'pdf'): string {
  const params = new URLSearchParams({ format });
  if (query.status) params.set('status', query.status);
  if (query.sourceLocationId) params.set('sourceLocationId', query.sourceLocationId);
  if (query.destinationLocationId) params.set('destinationLocationId', query.destinationLocationId);
  if (query.createdFrom) params.set('createdFrom', query.createdFrom);
  if (query.createdTo) params.set('createdTo', query.createdTo);
  return `/api/v1/inventory/transfers/export?${params}`;
}

export async function getTransfer(id: string): Promise<Transfer> {
  return serverApiFetch<Transfer>(`/api/v1/inventory/transfers/${id}`);
}
