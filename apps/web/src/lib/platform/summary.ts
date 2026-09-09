import { serverApiFetch } from '../api/server';
import type { PlatformSummary } from '../types/platform-summary';

/**
 * Server-side read for the SuperAdmin platform dashboard (`GET /api/v1/platform/summary`,
 * `@PlatformOnly()`, F18-10). Uses the shared `serverApiFetch` — it forwards the `platform_*`
 * session cookies, same as `listPlatformTenants` (no parallel client).
 *
 * `from`/`to` are optional but must be sent **together** — a half-open `[from, to)` window on
 * `tenants.created_at` for the "new companies" count (the endpoint 400s on a half period). This
 * helper never sends a `tenantId` — the endpoint has no such parameter and the aggregate is the
 * whole platform by construction.
 */
export async function getPlatformSummary(range?: { from: string; to: string }): Promise<PlatformSummary> {
  const query: Record<string, string> = {};
  if (range) {
    query['from'] = range.from;
    query['to'] = range.to;
  }
  return serverApiFetch<PlatformSummary>('/api/v1/platform/summary', { query });
}
