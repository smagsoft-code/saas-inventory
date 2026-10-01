import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { withTenantTransaction } from '../../database/tenant-context';
import { LocationAuthorizationService } from '../location-authorization.service';
import { LocationScopeResponseDto } from './dto/location-scope-response.dto';

/**
 * The caller's own ADR-0024 location-scoped-authorization operating scope — read-only, self-data,
 * no `@RequirePermissions()` beyond authentication (same posture as `/auth/me`): every
 * authenticated tenant user is entitled to know which locations THEY can operate on, independent
 * of whether they also hold `core.users.locations.manage` (the separate permission that gates
 * viewing/editing OTHER users' assignments via `LocationAssignmentsController`).
 *
 * Lives in INVENTORY, not CORE/auth — same module-ownership reasoning
 * `location-assignments.service.ts` already documents ("INVENTORY owns the table ... CORE never
 * depends on INVENTORY").
 */
@ApiTags('inventory-location-scope')
@Controller('inventory/location-scope')
export class LocationScopeController {
  constructor(private readonly locationAuthorizationService: LocationAuthorizationService) {}

  @Get()
  @ApiOkResponse({ type: LocationScopeResponseDto })
  async getMine(@CurrentTenant() tenantId: string, @CurrentUser() principal: AuthPrincipal): Promise<LocationScopeResponseDto> {
    return withTenantTransaction(tenantId, (tx) => this.locationAuthorizationService.getOperatingScope(tx, tenantId, principal.userId));
  }
}
