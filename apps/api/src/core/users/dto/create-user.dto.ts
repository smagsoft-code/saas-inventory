import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/** No `tenantId` field, deliberately — §13: the tenant a new user is created in is always
 * CurrentTenant, never client-supplied. `roleId` is optional; assigning one requires the caller to
 * additionally hold `core.roles.assign` (checked in UsersService, not here — see §13's "comprobar
 * que quien crea tiene permiso para asignarlo").
 *
 * `email` is the login identifier (UI label "Usuario") — despite the property name, kept
 * unchanged for wire-contract stability, it is not required to be a real email address. Nothing
 * downstream depends on email *format*: `identities.email` (ADR-0033) is a plain, globally
 * case-insensitive-unique text column with no format CHECK, matched by exact string equality
 * (`IdentitiesRepository`), and `LoginDto.email` accepts the same free-form identifier — only the
 * 10-character minimum is enforced, matching the existing password minimum. */
export class CreateUserDto {
  @ApiProperty({ type: String, minLength: 10, maxLength: 128, description: 'Login identifier ("Usuario"). Minimum 10 characters — does not need to be a valid email address.' })
  @IsString()
  @Length(10, 128)
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
