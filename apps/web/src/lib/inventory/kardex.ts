import { apiFetch } from '../api/client';
import type { KardexExportFormat, KardexResponse } from '../types/kardex';

/**
 * Client-side calls only (`apiFetch`, not `serverApiFetch`) — the Kardex screen is deliberately
 * search-first and on-demand (UI-UX-SPEC-001 §1/§22: nothing loads until the user searches a
 * product or picks "Ver todos"), so there is no server-rendered initial fetch to wire up here.
 */
export interface GetKardexQuery {
  productVariantId: string;
  locationId: string;
  from?: string;
  to?: string;
}

export async function getKardex(query: GetKardexQuery): Promise<KardexResponse> {
  const params: Record<string, string> = { productVariantId: query.productVariantId, locationId: query.locationId };
  if (query.from) params['from'] = query.from;
  if (query.to) params['to'] = query.to;
  return apiFetch<KardexResponse>('/api/v1/reports/kardex', { query: params });
}

/** A plain same-origin URL, not a fetch call — the browser handles the binary download and
 * `Content-Disposition` header itself, the same `<a href="/api/v1/imports/template">` pattern
 * `import-upload-form.tsx` already uses for its template download. */
export function buildKardexExportHref(query: GetKardexQuery, format: KardexExportFormat): string {
  const params = new URLSearchParams({ productVariantId: query.productVariantId, locationId: query.locationId, format });
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  return `/api/v1/reports/kardex/export?${params.toString()}`;
}
