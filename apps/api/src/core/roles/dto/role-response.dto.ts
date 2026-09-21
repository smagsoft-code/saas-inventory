import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Shared response shape for every roles endpoint — `GET /roles`, `GET /roles/:id`,
 * `POST /roles`, `PATCH /roles/:id`, `PUT /roles/:id/permissions` (ROLES/PERMISSIONS block,
 * closing `GAP-ROLE-CRUD`). */
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

  @ApiProperty({
    type: Boolean,
    description:
      'Whether this role is currently assigned to the caller. ADR-0034: PUT /roles/:id/permissions rejects any call where this is true, regardless of core.roles.manage.',
  })
  isAssignedToCaller!: boolean;
}
