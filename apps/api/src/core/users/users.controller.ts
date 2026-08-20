import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

/**
 * Users within the caller's own tenant only (§10–§16). Every route runs the full guard chain
 * (JwtAuthGuard -> TenantGuard -> CsrfGuard -> PermissionsGuard, common.module.ts) — `tenantId`
 * always comes from CurrentTenant, `userId` for the acting user from CurrentUser, both resolved
 * from the verified token, never from the request body/query/path beyond the target user's own id.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('core.users.read')
  @ApiOkResponse({ type: UserResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedResult<UserResponseDto>> {
    return this.usersService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('core.users.read')
  @ApiOkResponse({ type: UserResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<UserResponseDto> {
    return this.usersService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('core.users.create')
  @ApiCreatedResponse({ type: UserResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: string[],
    @Body() dto: CreateUserDto,
    @Req() request: FastifyRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.create(tenantId, principal.userId, permissions, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id')
  @RequirePermissions('core.users.update')
  @ApiOkResponse({ type: UserResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: string[],
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: FastifyRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.update(tenantId, principal.userId, permissions, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
