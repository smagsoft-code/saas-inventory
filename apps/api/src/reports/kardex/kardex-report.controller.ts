import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentReaderId } from '../../common/decorators/current-reader-id.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { KardexExportQueryDto } from './dto/kardex-export-query.dto';
import { KardexQueryDto } from './dto/kardex-query.dto';
import { KardexResponseDto } from './dto/kardex-response.dto';
import { KardexExportService } from './kardex-export.service';
import { KardexReportService } from './kardex-report.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';

/**
 * UI-UX-SPEC-001's Kardex. Reuses `inventory.view` as-is (same posture as `GET /inventory/movements`
 * and every other FASE 18 report — a report gates on the `*.view` permission of the domain it reports
 * on). Scope is tenant-wide, matching `GET /inventory/movements`/`GET /inventory/balances` — a Kardex
 * is a read, and ADR-0024's location-authorization guard only ever gates a write-path action.
 *
 * Cost fields (`unitCost`, `averageCostAfter`, `stockValueAfter`, `opening`/`closing.averageCost`/
 * `.stockValue`/`.estimated`) are field-gated on `pricing.cost.view` (ADR-0028's existing precedent),
 * exactly like `GET /inventory/movements`'s own `unitCost` and `GET /reports/inventory-summary`'s
 * `totalCostValue` — a caller with only `inventory.view` still gets quantities and labels.
 */
@ApiTags('reports')
@Controller('reports')
export class KardexReportController {
  constructor(
    private readonly kardexReportService: KardexReportService,
    private readonly kardexExportService: KardexExportService,
  ) {}

  @Get('kardex')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: KardexResponseDto })
  async getKardex(
    @CurrentTenant() tenantId: string,
    @CurrentReaderId() readerId: string,
    @Query() query: KardexQueryDto,
    @CurrentPermissions() permissions: string[],
  ): Promise<KardexResponseDto> {
    const canViewCost = permissions.includes('pricing.cost.view');
    return this.kardexReportService.getKardex(tenantId, query, canViewCost, { userId: readerId, permissions });
  }

  @Get('kardex/export')
  @RequirePermissions('inventory.view')
  async exportKardex(
    @CurrentTenant() tenantId: string,
    @CurrentReaderId() readerId: string,
    @Query() query: KardexExportQueryDto,
    @CurrentPermissions() permissions: string[],
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const canViewCost = permissions.includes('pricing.cost.view');
    const [data, context] = await Promise.all([
      this.kardexReportService.getKardex(tenantId, query, canViewCost, { userId: readerId, permissions }),
      this.kardexReportService.getExportContext(tenantId, query.productVariantId, query.locationId),
    ]);
    const exportContext = { ...context, from: query.from, to: query.to, canViewCost };

    if (query.format === 'xlsx') {
      const buffer = await this.kardexExportService.buildXlsx(data, exportContext);
      void reply.header('Content-Type', XLSX_MIME);
      void reply.header('Content-Disposition', 'attachment; filename="kardex.xlsx"');
      return buffer;
    }
    const buffer = await this.kardexExportService.buildPdf(data, exportContext);
    void reply.header('Content-Type', PDF_MIME);
    void reply.header('Content-Disposition', 'attachment; filename="kardex.pdf"');
    return buffer;
  }
}
