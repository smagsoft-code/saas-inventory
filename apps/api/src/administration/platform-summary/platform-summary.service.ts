import { BadRequestException, Injectable } from '@nestjs/common';
import { toHalfOpenRange } from '../../common/reporting/date-range';
import type { PlatformSummaryQueryDto } from './dto/platform-summary-query.dto';
import type { PlatformSummaryResponseDto } from './dto/platform-summary-response.dto';
import { PlatformSummaryRepository } from './platform-summary.repository';

/**
 * `GET /platform/summary` (F18-10 — "Super-Admin Platform Metrics"). Resolves the platform metrics
 * the reporting catalogue marks implementable over the `tenants` table alone:
 *
 * - `PLAT-TENANT-COUNT` / `KPI-PLAT-TENANTS` — **A** (was "array length" client-side).
 * - `PLAT-TENANT-BY-STATUS` / `KPI-PLAT-TENANTS-STATUS` — **A** (was "group the array client-side").
 * - `PLAT-DEMO-COUNT` — **A** (was "is_demo on the array").
 * - `PLAT-TENANT-CREATED` / `KPI-PLAT-TENANTS-NEW` — **B → A**: a real server-side
 *   `COUNT(*) WHERE created_at IN [from, to)`, the metric's verbatim formula, was "no server-side
 *   filter".
 *
 * Deliberately **not** resolved (each blocked, documented as a gap, not implemented speculatively):
 * `KPI-PLAT-ACTIVITY` / `PLAT-USERS-PER-TENANT` (`GAP-PLATFORM-AGGREGATE` — needs an ADR + a
 * dedicated audited cross-tenant read path over tenant-scoped tables), `KPI-PLAT-BILLING`
 * (`GAP-SA-BILLING` — no billing/plan/subscription model exists anywhere), and a platform audit
 * view (`GAP-SA-AUDIT`). Common SaaS metrics with no documented definition (MRR/ARR/churn/DAU/MAU/
 * LTV/uptime/health/adoption/conversion) are **not** implemented.
 */
@Injectable()
export class PlatformSummaryService {
  constructor(private readonly platformSummaryRepository: PlatformSummaryRepository) {}

  async getSummary(query: PlatformSummaryQueryDto): Promise<PlatformSummaryResponseDto> {
    const { from, to } = query;
    // Both-or-neither: a half period is a client mistake, not a defaulted window.
    if ((from && !to) || (to && !from)) {
      throw new BadRequestException('`from` and `to` must be supplied together.');
    }
    if (from && to && new Date(from).getTime() >= new Date(to).getTime()) {
      throw new BadRequestException('`from` must be strictly before `to`.');
    }

    const counts = await this.platformSummaryRepository.counts();

    let period: PlatformSummaryResponseDto['period'] = null;
    if (from && to) {
      const range = toHalfOpenRange(from, to);
      const newInPeriod = await this.platformSummaryRepository.newInPeriod(range.gte, range.lt);
      period = { from, to, newInPeriod };
    }

    return {
      generatedAt: new Date().toISOString(),
      totalCount: Number(counts.totalCount),
      byStatus: {
        active: Number(counts.activeCount),
        suspended: Number(counts.suspendedCount),
        archived: Number(counts.archivedCount),
      },
      demoCount: Number(counts.demoCount),
      period,
    };
  }
}
