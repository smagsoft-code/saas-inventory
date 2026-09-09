import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { PlatformSummaryQueryDto } from './dto/platform-summary-query.dto';
import { PlatformSummaryResponseDto } from './dto/platform-summary-response.dto';
import { PlatformSummaryService } from './platform-summary.service';

/**
 * SuperAdmin-only platform metrics (F18-10). `@PlatformOnly()` **alone** — never
 * `@RequirePermissions()` (there is no tenant permission catalog entry for a platform route, by
 * design: ADR-0032 rule 4, security.md — a tenant Administrador role can never be configured into
 * platform access). ADR-0032 line 101-103 names this exact mechanism for "platform metrics":
 * `@PlatformOnly()`, never a bespoke authorization path.
 *
 * Lives under `/platform/*` alongside `platform-tenants` (the platform namespace), **not**
 * `/reports/*` — REPORTS is the tenant-scoped read-side (`@RequirePermissions`-gated aggregation
 * across CORE/CATALOG/INVENTORY/SALES); a platform capability belongs in the platform namespace,
 * per multi-tenancy.md's "SuperAdmin capabilities are explicit, narrow endpoints".
 *
 * Aggregates the `tenants` table **alone** — returns numeric counts only, never an individual
 * tenant's fields, never any tenant-scoped data.
 */
@ApiTags('platform-administration')
@Controller('platform/summary')
@PlatformOnly()
export class PlatformSummaryController {
  constructor(private readonly platformSummaryService: PlatformSummaryService) {}

  @Get()
  @ApiOkResponse({ type: PlatformSummaryResponseDto })
  async summary(@Query() query: PlatformSummaryQueryDto): Promise<PlatformSummaryResponseDto> {
    return this.platformSummaryService.getSummary(query);
  }
}
