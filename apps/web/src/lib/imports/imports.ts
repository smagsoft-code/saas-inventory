import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { ImportJob, ImportJobRow, ImportJobStatus, ImportPreview, ImportRowStatus } from '../types/imports';

/**
 * Server-side reads for the import pipeline (`GET /api/v1/imports*`, permission `import.execute`).
 * Every mutation (`POST /imports` multipart, `/:id/mapping`, `/:id/validate`, `/:id/confirm`,
 * `/:id/cancel`, template CRUD) goes through `apiFetch` in the relevant client component — the same
 * read/write split every other F17 module uses. `POST /imports` takes **no** `Idempotency-Key`
 * (the backend does not accept one) and the template/error-report downloads are plain `<a>` links
 * to the API path (a GET needs only the session cookie, no CSRF, and returns a binary body the
 * JSON client would not handle).
 *
 * `ListImportJobsQueryDto` accepts only `{ page, pageSize, status? }` — a single status
 * (`GAP-MULTI-STATUS`), no text search (`GAP-SEARCH`), no date range, no other filter.
 */
export interface ListImportJobsQuery {
  page?: number;
  pageSize?: number;
  status?: ImportJobStatus;
}

export async function listImportJobs(query: ListImportJobsQuery = {}): Promise<Paginated<ImportJob>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<Paginated<ImportJob>>('/api/v1/imports', { query: params });
}

export async function getImportJob(id: string): Promise<ImportJob> {
  return serverApiFetch<ImportJob>(`/api/v1/imports/${id}`);
}

export async function getImportPreview(id: string): Promise<ImportPreview> {
  return serverApiFetch<ImportPreview>(`/api/v1/imports/${id}/preview`);
}

export interface ListImportJobRowsQuery {
  page?: number;
  pageSize?: number;
  status?: ImportRowStatus;
}

export async function listImportJobRows(id: string, query: ListImportJobRowsQuery = {}): Promise<Paginated<ImportJobRow>> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 50,
  };
  if (query.status) {
    params['status'] = query.status;
  }
  return serverApiFetch<Paginated<ImportJobRow>>(`/api/v1/imports/${id}/rows`, { query: params });
}
