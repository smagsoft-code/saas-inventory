import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/** No `tenantId` field, deliberately — §13: the tenant a new user is created in is always
 * CurrentTenant, never client-supplied. `roleId` is optional; assigning one requires the caller to
 * additionally hold `core.roles.assign` (checked in UsersService, not here — see §13's "comprobar
 * que quien crea tiene permiso para asignarlo"). */
export class CreateUserDto {
  @ApiProperty({ type: String })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty({ type: String, minLength: 10, maxLength: 128, description: 'Minimum 10 characters.' })
  @IsString()
  @Length(10, 128)
  password!: string;

  @ApiPropertyOptional({ type: String, description: 'A role id belonging to the current tenant. Requires core.roles.assign.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
