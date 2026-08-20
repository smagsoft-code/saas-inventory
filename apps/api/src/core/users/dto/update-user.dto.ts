import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const USER_STATUSES = ['invited', 'active', 'disabled'] as const;

/** Every field is optional (PATCH semantics) and every field is checked for the specific
 * permission it needs in UsersService — `status`/`fullName` need `core.users.update`, `roleId`
 * needs the stricter `core.roles.assign` — never inferred from whichever fields happen to be
 * present. No `email`/`passwordHash`/`tenantId` field exists here at all (§13/§14 mass-assignment
 * rule) — changing a user's own login email or password is out of this phase's scope. */
export class UpdateUserDto {
  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({ type: String, description: 'A role id belonging to the current tenant. Requires core.roles.assign.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
