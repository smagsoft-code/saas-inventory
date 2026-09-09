/**
 * F18-10 ("Super-Admin Platform Metrics") — mirrors `GET /api/v1/platform/summary`'s real response
 * shape (`apps/api/src/administration/platform-summary/dto/platform-summary-response.dto.ts`), the
 * same "no field is added that the endpoint does not send" convention as `lib/types/platform-tenant.ts`.
 *
 * `@PlatformOnly()` — the platform principal is the whole authorization; no tenant RBAC, no
 * permission code. Aggregates the `tenants` table **alone**: numeric counts only, never an
 * individual tenant's id/name/slug, never any tenant-scoped data (`GAP-PLATFORM-AGGREGATE`), never
 * any billing figure (`GAP-SA-BILLING`).
 *
 * No `timezone` / `currency`. `period` is `null` unless both `from` and `to` are sent — a half-open
 * `[from, to)` window on `tenants.created_at` (`PLAT-TENANT-CREATED` / `KPI-PLAT-TENANTS-NEW`).
 */

export interface PlatformSummary {
  generatedAt: string;
  totalCount: number;
  byStatus: { active: number; suspended: number; archived: number };
  demoCount: number;
  period: { from: string; to: string; newInPeriod: number } | null;
}
