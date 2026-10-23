import { BadRequestException, Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BulkReceiptsService, type BulkReceiptInput, type BulkReceiptPreview, type BulkReceiptResult } from './bulk-receipts.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the `file` part plus the `locationId` / `occurredOn` text fields off a multipart request
 * (`@fastify/multipart`'s `request.parts()`; a ValidationPipe never sees a multipart body, so the two
 * fields are validated by hand here — same approach as the import upload). `tenantId` is never read
 * from the request. */
async function readParts(request: FastifyRequest): Promise<BulkReceiptInput> {
  let buffer: Buffer | undefined;
  let filename = '';
  let mimeType = '';
  const fields: Record<string, string> = {};
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file') continue;
      filename = part.filename;
      mimeType = part.mimetype;
      buffer = await part.toBuffer();
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }
  if (!buffer) {
    throw new BadRequestException('No se subió ningún archivo (se esperaba el campo multipart "file").');
  }
  const locationId = fields['locationId'] ?? '';
  if (!UUID_PATTERN.test(locationId)) {
    throw new BadRequestException('Elige el almacén al que se cargará el stock (locationId).');
  }
  return { buffer, filename, mimeType, locationId, ...(fields['occurredOn'] ? { occurredOn: fields['occurredOn'] } : {}) };
}

/**
 * Bulk stock load ("Carga masiva" in Agregar stock): `inventory.adjust` — the same single permission
 * "Agregar stock" needs — plus the ADR-0024 location check on the chosen almacén (done in the
 * service). `/preview` only validates (writes nothing) and returns every row with its errors;
 * the confirm call re-validates and writes all rows or none, and needs an `Idempotency-Key`.
 */
@ApiTags('inventory-bulk-receipts')
@Controller('inventory/receipts/bulk')
export class BulkReceiptsController {
  constructor(private readonly bulkReceiptsService: BulkReceiptsService) {}

  @Get('template')
  @RequirePermissions('inventory.adjust')
  async template(
    @CurrentTenant() tenantId: string,
    @CurrentPermissions() permissions: string[],
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const buffer = await this.bulkReceiptsService.buildTemplate(tenantId, permissions.includes('pricing.cost.view'));
    void reply.header('Content-Type', XLSX_MIME);
    void reply.header('Content-Disposition', 'attachment; filename="plantilla-carga-de-stock.xlsx"');
    return buffer;
  }

  @Post('preview')
  @RequirePermissions('inventory.adjust')
  @ApiOkResponse({ description: 'Every row of the file with its errors (if any); nothing is written.' })
  async preview(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<BulkReceiptPreview> {
    return this.bulkReceiptsService.preview(tenantId, principal.userId, await readParts(request));
  }

  @Post()
  @RequirePermissions('inventory.adjust')
  @ApiCreatedResponse({ description: 'All rows loaded (or 422 with nothing written).' })
  async confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
    @CurrentPermissions() permissions: string[],
  ): Promise<BulkReceiptResult> {
    return this.bulkReceiptsService.confirm(
      tenantId,
      principal.userId,
      await readParts(request),
      idempotencyKey,
      { correlationId: request.correlationId, ipAddress: request.ip },
      permissions.includes('pricing.cost.view'),
    );
  }
}
