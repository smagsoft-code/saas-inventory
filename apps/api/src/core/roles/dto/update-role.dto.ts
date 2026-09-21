import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/** `core.roles.manage`. Name/description only — never `isSystemDefault` (fixed at provisioning)
 * and never the permission set (`PUT /roles/:id/permissions`, its own endpoint with its own
 * ADR-0034 self-escalation check). Deliberately allowed on the caller's own currently-assigned
 * role — ADR-0034 blocks only permission changes, never renaming/describing. */
export class UpdateRoleDto {
  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}
