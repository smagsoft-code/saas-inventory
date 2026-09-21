import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsString } from 'class-validator';

/** `core.roles.manage` + ADR-0034 (a caller can never call this on a role currently assigned to
 * themselves, checked live in RolesService.setPermissions — no permission grant bypasses it).
 * Replaces the role's entire permission set (same "PUT replaces the whole set" convention as
 * `SetUserLocationsDto`) — an empty array is valid (a role with no permissions). Every code is
 * validated against the platform catalog before writing; an unknown code is a 400. */
export class SetRolePermissionsDto {
  @ApiProperty({ type: String, isArray: true, description: 'Permission codes from the platform catalog. Replaces the role\'s entire set.' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes!: string[];
}
