import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Read-only in this phase (§17/§23/§27 of Prompt 05-A) — role/permission CRUD (creating a
 * custom role, toggling a role's permission checklist) is a larger, separable feature deliberately
 * left out of scope; see the final report's "Pendientes" section. This is only what user
 * administration needs: which roles exist in this tenant, to assign one to a user. */
export class RoleResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  description?: string | undefined;

  @ApiProperty({ type: Boolean, description: 'Copied from the fixed DEFAULT_ROLE_TEMPLATES at provisioning time — a label, not a protection (database.md).' })
  isSystemDefault!: boolean;

  @ApiProperty({ type: [String] })
  permissionCodes!: string[];
}
