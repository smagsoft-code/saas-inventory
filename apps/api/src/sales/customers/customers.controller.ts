import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CustomersExportService } from './customers-export.service';
import { CustomersService } from './customers.service';
import { ExportCustomersQueryDto } from './dto/export-customers-query.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerResponseDto } from './dto/customer-response.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * Customers within the caller's own tenant only — database.md#customers-and-suppliers, modules.md#sales.
 * `tenantId` always comes from CurrentTenant, never the request body/query (§9). API surface matches
 * api.md's REST conventions: GET/POST /customers, GET/PATCH /customers/:id (§79).
 */
@ApiTags('sales-customers')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly customersExportService: CustomersExportService,
  ) {}

  @Get()
  @RequirePermissions('sales.customers.view')
  @ApiOkResponse({ type: CustomerResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListCustomersQueryDto): Promise<PaginatedResult<CustomerResponseDto>> {
    return this.customersService.list(tenantId, query);
  }

  /** Excel/PDF of the filtered list. Declared before `:id` so `export` is never read as an id. */
  @Get('export')
  @RequirePermissions('sales.customers.view')
  async exportCustomers(
    @CurrentTenant() tenantId: string,
    @Query() query: ExportCustomersQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const file = await this.customersExportService.build(tenantId, query);
    void reply.header('Content-Type', file.contentType);
    void reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.buffer;
  }

  @Get(':id')
  @RequirePermissions('sales.customers.view')
  @ApiOkResponse({ type: CustomerResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<CustomerResponseDto> {
    return this.customersService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('sales.customers.manage')
  @ApiCreatedResponse({ type: CustomerResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateCustomerDto,
    @Req() request: FastifyRequest,
  ): Promise<CustomerResponseDto> {
    return this.customersService.create(tenantId, principal.userId, dto, { correlationId: request.correlationId, ipAddress: request.ip });
  }

  @Patch(':id')
  @RequirePermissions('sales.customers.manage')
  @ApiOkResponse({ type: CustomerResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() request: FastifyRequest,
  ): Promise<CustomerResponseDto> {
    return this.customersService.update(tenantId, principal.userId, id, dto, { correlationId: request.correlationId, ipAddress: request.ip });
  }
}
