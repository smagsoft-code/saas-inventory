import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ImportsSummaryQueryDto } from './dto/imports-summary-query.dto';
import { ImportsSummaryResponseDto } from './dto/imports-summary-response.dto';
import { ImportsReportService } from './imports-report.service';

/**
 * FASE 18 read-side (F18-09 — "Imports analytics"). Reuses `import.execute` as-is — F18-01's
 * ratified decision: no `reports.*`/`analytics.*` permission family, a report gates on the domain's
 * own permission. IMPORT has a single permission for the whole flow (database.md's RBAC design:
 * "una permission para todo el flujo, no cinco"), which is `import.execute` — the exact permission
 * every `IMP-*` row in `metrics.md` and every `REP-IMP-*` in `reports.md` already names.
 * (`import.inventory` is an *additional* service-side gate for `update_catalog_and_inventory`
 * commits only — never a read gate.)
 *
 * Scope is **tenant-wide** — `import_jobs` has no location dimension; matches the operational
 * `GET /imports` list and every other FASE 18 report.
 */
@ApiTags('reports')
@Controller('reports')
export class ImportsReportController {
  constructor(private readonly importsReportService: ImportsReportService) {}

  @Get('imports-summary')
  @RequirePermissions('import.execute')
  @ApiOkResponse({ type: ImportsSummaryResponseDto })
  async importsSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: ImportsSummaryQueryDto,
  ): Promise<ImportsSummaryResponseDto> {
    return this.importsReportService.getImportsSummary(tenantId, query);
  }
}
