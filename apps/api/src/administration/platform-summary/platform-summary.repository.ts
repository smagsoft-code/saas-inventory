import { Inject, Injectable } from '@nestjs/common';
import { and, gte, lt, sql } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { tenants } from '../../database/schema';

export interface PlatformTenantCountsRow {
  totalCount: string;
  activeCount: string;
  suspendedCount: string;
  archivedCount: string;
  demoCount: string;
}

/**
 * `administration/platform-summary` read-side (F18-10). A **dedicated** aggregate repository over
 * the platform-scoped `tenants` table — never `TenantsPlatformRepository` (that is the lifecycle /
 * write-path repository: `list`/`findById`/`setStatus`/`create`/`updateName`), same rule every
 * FASE 18 report follows (`SalesReportRepository` ≠ `OrdersRepository`, etc.).
 *
 * Runs on the `app_platform` connection (`@Inject(PLATFORM_DATABASE)`) — the one role granted
 * `SELECT ON tenants` (migration 0001; `app_tenant` has **no** grant on `tenants` at all).
 * `tenants` is platform-scoped: **no `tenant_id`, no RLS** — access is by GRANT alone
 * (`multi-tenancy.md`: "exactly the tables the SuperAdmin context is allowed to touch directly").
 * This repository touches **only `tenants`** — no join to `users`/`orders`/any tenant-scoped table
 * (that is `GAP-PLATFORM-AGGREGATE`, blocked).
 *
 * `tenants` is operationally tiny (one row per company). A single `COUNT(*)` with `FILTER` clauses
 * over the whole table is trivial — no index beyond the existing PK is needed, and none is added
 * (CLAUDE.md §7.7 — indexes on real query patterns, not speculation).
 */
@Injectable()
export class PlatformSummaryRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  /** All the point-in-time counts in one pass over `tenants`. */
  async counts(): Promise<PlatformTenantCountsRow> {
    const [row] = await this.platformDb
      .select({
        totalCount: sql<string>`count(*)`,
        activeCount: sql<string>`count(*) filter (where ${tenants.status} = 'active')`,
        suspendedCount: sql<string>`count(*) filter (where ${tenants.status} = 'suspended')`,
        archivedCount: sql<string>`count(*) filter (where ${tenants.status} = 'archived')`,
        demoCount: sql<string>`count(*) filter (where ${tenants.isDemo} = true)`,
      })
      .from(tenants);
    return (
      row ?? { totalCount: '0', activeCount: '0', suspendedCount: '0', archivedCount: '0', demoCount: '0' }
    );
  }

  /** `COUNT(*)` of tenants created in the half-open `[from, to)` window (`PLAT-TENANT-CREATED`). */
  async newInPeriod(from: Date, to: Date): Promise<number> {
    const [row] = await this.platformDb
      .select({ count: sql<string>`count(*)` })
      .from(tenants)
      .where(and(gte(tenants.createdAt, from), lt(tenants.createdAt, to)));
    return Number(row?.count ?? '0');
  }
}
