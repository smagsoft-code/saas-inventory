import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Patch, Put, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthPrincipal } from '../../common/context/request-context';
import { TenantResponseDto } from './dto/tenant-response.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantLogoService } from './tenant-logo.service';
import { TenantService } from './tenant.service';

function toResponse(
  tenant: { id: string; name: string; slug: string; status: string; isDemo: boolean; createdAt: Date },
  logoVersion?: number,
): TenantResponseDto {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    isDemo: tenant.isDemo,
    createdAt: tenant.createdAt.toISOString(),
    ...(logoVersion !== undefined ? { logoVersion } : {}),
  };
}

/** Reads the required `file` part off a multipart request — same `request.parts()` pattern the
 * product image upload uses (no class-validator DTO can see a multipart body). */
async function readLogoUpload(request: FastifyRequest): Promise<{ buffer: Buffer; mimeType: string }> {
  for await (const part of request.parts()) {
    if (part.type === 'file' && part.fieldname === 'file') {
      return { buffer: await part.toBuffer(), mimeType: part.mimetype };
    }
  }
  throw new BadRequestException('No file was uploaded (expected a multipart "file" field).');
}

/**
 * The caller's own tenant only — there is no "list tenants" or "look up another tenant" endpoint
 * here, by design (§7/multi-tenancy.md). `tenantId` always comes from CurrentTenant (the verified
 * token via TenantGuard), never from a route/query param.
 */
@ApiTags('tenant')
@Controller('tenant')
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantLogoService: TenantLogoService,
  ) {}

  @Get()
  @ApiOkResponse({ type: TenantResponseDto })
  async getCurrent(@CurrentTenant() tenantId: string): Promise<TenantResponseDto> {
    const [tenant, logoVersion] = await Promise.all([this.tenantService.getCurrent(tenantId), this.tenantLogoService.getVersion(tenantId)]);
    return toResponse(tenant, logoVersion);
  }

  /** The company logo bytes — any member of the tenant may read it (the shell shows it to everyone). */
  @Get('logo')
  async getLogo(@CurrentTenant() tenantId: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    const { buffer, mimeType } = await this.tenantLogoService.getBinary(tenantId);
    void reply.header('Content-Type', mimeType);
    // The page appends `?v=<logoVersion>`, so a new logo is a new URL and the old one may be cached.
    void reply.header('Cache-Control', 'private, max-age=86400');
    return buffer;
  }

  @Put('logo')
  @RequirePermissions('core.tenant.update')
  async uploadLogo(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<{ logoVersion: number }> {
    const file = await readLogoUpload(request);
    return this.tenantLogoService.upload(tenantId, file, { actorId: principal.userId, correlationId: request.correlationId, ipAddress: request.ip });
  }

  @Delete('logo')
  @RequirePermissions('core.tenant.update')
  @HttpCode(204)
  async removeLogo(@CurrentTenant() tenantId: string, @CurrentUser() principal: AuthPrincipal, @Req() request: FastifyRequest): Promise<void> {
    await this.tenantLogoService.remove(tenantId, { actorId: principal.userId, correlationId: request.correlationId, ipAddress: request.ip });
  }

  @Patch()
  @RequirePermissions('core.tenant.update')
  @ApiOkResponse({ type: TenantResponseDto })
  async updateCurrent(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: UpdateTenantDto,
    @Req() request: FastifyRequest,
  ): Promise<TenantResponseDto> {
    const updated = await this.tenantService.updateCurrent(tenantId, dto, {
      actorId: principal.userId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toResponse(updated);
  }
}
