import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SetUserLocationsDto } from './dto/set-user-locations.dto';
import { UserLocationResponseDto } from './dto/user-location-response.dto';
import { LocationAssignmentsService } from './location-assignments.service';

/**
 * A tenant user's location-scoped-authorization assignments (ADR-0024) within the caller's own
 * tenant only. Gated by `core.users.locations.manage` — already seeded (migration 0001) and already
 * on the Administrador template (packages/shared/src/index.ts). Every route runs the full guard
 * chain (JwtAuthGuard -> TenantGuard -> CsrfGuard -> PermissionsGuard).
 */
@ApiTags('users')
@Controller('users/:userId/locations')
export class LocationAssignmentsController {
  constructor(private readonly locationAssignmentsService: LocationAssignmentsService) {}

  @Get()
  @RequirePermissions('core.users.locations.manage')
  @ApiOkResponse({ type: UserLocationResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Param('userId') userId: string): Promise<UserLocationResponseDto[]> {
    return this.locationAssignmentsService.list(tenantId, userId);
  }

  @Put()
  @RequirePermissions('core.users.locations.manage')
  @ApiOkResponse({ type: UserLocationResponseDto, isArray: true })
  async replace(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('userId') userId: string,
    @Body() dto: SetUserLocationsDto,
    @Req() request: FastifyRequest,
  ): Promise<UserLocationResponseDto[]> {
    return this.locationAssignmentsService.replace(tenantId, principal.userId, userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
