import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Never `password_hash` (§14) — every field below is safe to return to an authorized caller
 * within the same tenant. Used for both the list (§11) and detail (§12) endpoints. */
export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ enum: ['invited', 'active', 'disabled'] })
  status!: string;

  @ApiProperty({ type: [String], description: 'Names of the roles currently assigned to this user.' })
  roleNames!: string[];

  @ApiPropertyOptional()
  lastLoginAt?: string | undefined;

  @ApiProperty()
  createdAt!: string;
}
