import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaymentsExportQueryDto, PaymentsReportQueryDto } from './dto/payments-report-query.dto';
import { PaymentsReportResponseDto } from './dto/payments-report-response.dto';
import { PaymentsExportService } from './payments-export.service';
import { PaymentsReportService } from './payments-report.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';

/**
 * The payment-method detail report. `sales.orders.view` is reused as-is (F18-01: a report gates on
 * the `*.view` permission of the domain it reports on, no `reports.*` family). Scope mirrors
 * `GET /orders`: location read scope (ADR-0024/0035) and, without `sales.orders.view_all`, only the
 * caller's own orders.
 */
@ApiTags('reports')
@Controller('reports')
export class PaymentsReportController {
  constructor(
    private readonly paymentsReportService: PaymentsReportService,
    private readonly paymentsExportService: PaymentsExportService,
  ) {}

  @Get('payments')
  @RequirePermissions('sales.orders.view')
  @ApiOkResponse({ type: PaymentsReportResponseDto })
  async payments(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: PaymentsReportQueryDto,
    @CurrentPermissions() permissions: string[],
  ): Promise<PaymentsReportResponseDto> {
    return this.paymentsReportService.getPayments(tenantId, principal.userId, query, permissions.includes('sales.orders.view_all'));
  }

  @Get('payments/export')
  @RequirePermissions('sales.orders.view')
  async exportPayments(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: PaymentsExportQueryDto,
    @CurrentPermissions() permissions: string[],
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const data = await this.paymentsReportService.getPayments(tenantId, principal.userId, query, permissions.includes('sales.orders.view_all'), true);
    const context = { timezone: data.timezone, currency: data.currency, dateFrom: query.dateFrom, dateTo: query.dateTo, truncated: data.truncated };
    if (query.format === 'xlsx') {
      const buffer = await this.paymentsExportService.buildXlsx(data, context);
      void reply.header('Content-Type', XLSX_MIME);
      void reply.header('Content-Disposition', 'attachment; filename="formas-de-pago.xlsx"');
      return buffer;
    }
    const buffer = await this.paymentsExportService.buildPdf(data, context);
    void reply.header('Content-Type', PDF_MIME);
    void reply.header('Content-Disposition', 'attachment; filename="formas-de-pago.pdf"');
    return buffer;
  }
}
