import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

/**
 * Roles within the caller's own tenant only. `core.roles.read` for viewing (unchanged since
 * Prompt 05-A); `core.roles.manage` (new, ROLES/PERMISSIONS block) for create/update/permission-
 * replace/delete — a single flat permission, same "do not fragment the catalog" precedent
 * ADR-0031 already applied to `core.roles.assign`. `core.roles.assign` itself (assigning a role to
 * a *user*) stays in UsersController/UsersService, unaffected by this controller.
 */
@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('core.roles.read')
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @CurrentUser() principal: AuthPrincipal): Promise<RoleResponseDto[]> {
    return this.rolesService.list(tenantId, principal.userId);
  }

  @Get(':id')
  @RequirePermissions('core.roles.read')
  @ApiOkResponse({ type: RoleResponseDto })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<RoleResponseDto> {
    return this.rolesService.getById(tenantId, principal.userId, id);
  }

  @Post()
  @RequirePermissions('core.roles.manage')
  @ApiCreatedResponse({ type: RoleResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateRoleDto,
    @Req() request: FastifyRequest,
  ): Promise<RoleResponseDto> {
    return this.rolesService.create(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id')
  @RequirePermissions('core.roles.manage')
  @ApiOkResponse({ type: RoleResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Req() request: FastifyRequest,
  ): Promise<RoleResponseDto> {
    return this.rolesService.update(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Put(':id/permissions')
  @RequirePermissions('core.roles.manage')
  @ApiOkResponse({ type: RoleResponseDto })
  async setPermissions(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
    @Req() request: FastifyRequest,
  ): Promise<RoleResponseDto> {
    return this.rolesService.setPermissions(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Delete(':id')
  @RequirePermissions('core.roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.rolesService.remove(tenantId, principal.userId, id, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
