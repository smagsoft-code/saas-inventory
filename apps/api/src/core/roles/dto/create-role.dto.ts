import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString, Length } from 'class-validator';

/** `core.roles.manage`. No `tenantId`/`isSystemDefault` — the tenant is always CurrentTenant, and
 * a role created through this endpoint is always a custom (non-system-default) role; only tenant
 * provisioning's `RolesRepository.provisionTemplates` ever sets `isSystemDefault: true`.
 * `permissionCodes` defaults to an empty array (a role with no permissions yet is valid — the
 * admin can grant them via `PUT /roles/:id/permissions` after creating it), every code is
 * validated against the platform catalog in the service (RolesService.create), never trusted as-is
 * — an unknown code is a 400, not a raw FK violation. */
export class CreateRoleDto {
  @ApiProperty({ type: String, minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({ type: String, isArray: true, description: 'Permission codes from the platform catalog. Defaults to empty.' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes?: string[];
}
