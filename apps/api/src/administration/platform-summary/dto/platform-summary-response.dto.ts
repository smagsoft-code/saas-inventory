import { ApiProperty } from '@nestjs/swagger';

/** `COUNT(*) FILTER` per real `tenants.status` value (`tenants_status_check`, migration 0001 /
 * `01-platform.ts`). `active + suspended + archived === totalCount`. */
export class PlatformTenantsByStatusDto {
  @ApiProperty({ type: Number })
  active!: number;

  @ApiProperty({ type: Number })
  suspended!: number;

  @ApiProperty({ type: Number })
  archived!: number;
}

/** Present only when the caller supplied both `from` and `to` — a half-open `[from, to)` window on
 * `tenants.created_at`. `metrics.md` `PLAT-TENANT-CREATED` / `kpis.md` `KPI-PLAT-TENANTS-NEW`. */
export class PlatformNewTenantsPeriodDto {
  @ApiProperty({ type: String, format: 'date-time', description: 'Inclusive lower bound (echoed back).' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Exclusive upper bound (echoed back).' })
  to!: string;

  @ApiProperty({ type: Number, description: 'COUNT(*) of tenants whose created_at falls in [from, to).' })
  newInPeriod!: number;
}

/**
 * `GET /platform/summary` (F18-10). Aggregates the platform-scoped `tenants` table **alone** — the
 * only table `multi-tenancy.md` says "the SuperAdmin context is allowed to touch directly" for a
 * count. Returns **numeric aggregates only** — never an individual tenant's id / name / slug (that
 * is `GET /platform/tenants`), never any tenant-scoped data (`users`, `orders`, activity — that is
 * `GAP-PLATFORM-AGGREGATE`, blocked, needs an ADR), never any billing figure (no billing model
 * exists — `GAP-SA-BILLING`).
 *
 * `generatedAt` is the server clock at query time — an honest "as of now" marker for these
 * point-in-time counts (there is no snapshot history; `GAP-SNAPSHOTS`). No `currency`, no
 * `timezone` (a platform metric has no single tenant timezone).
 */
export class PlatformSummaryResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: Number, description: 'COUNT(*) of tenants (metrics.md PLAT-TENANT-COUNT / KPI-PLAT-TENANTS).' })
  totalCount!: number;

  @ApiProperty({ type: PlatformTenantsByStatusDto, description: 'metrics.md PLAT-TENANT-BY-STATUS / KPI-PLAT-TENANTS-STATUS.' })
  byStatus!: PlatformTenantsByStatusDto;

  @ApiProperty({ type: Number, description: 'COUNT(*) of tenants with is_demo = true (metrics.md PLAT-DEMO-COUNT).' })
  demoCount!: number;

  @ApiProperty({
    type: PlatformNewTenantsPeriodDto,
    nullable: true,
    description: 'null unless the caller supplied both `from` and `to` (metrics.md PLAT-TENANT-CREATED / KPI-PLAT-TENANTS-NEW).',
  })
  period!: PlatformNewTenantsPeriodDto | null;
}
