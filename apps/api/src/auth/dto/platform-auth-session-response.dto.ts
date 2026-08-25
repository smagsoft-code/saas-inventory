import { ApiProperty } from '@nestjs/swagger';

/** GET /platform/auth/me and every platform session-issuing response's admin shape — never the
 * password hash, never a token (security.md/CLAUDE.md §7.4, same posture as CurrentUserResponseDto). */
export class CurrentPlatformAdminResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  fullName!: string;

  @ApiProperty({ type: String })
  status!: string;
}

export class PlatformAuthSessionResponseDto {
  @ApiProperty({ type: CurrentPlatformAdminResponseDto })
  admin!: CurrentPlatformAdminResponseDto;

  @ApiProperty({ type: String, description: 'ISO timestamp the current access token expires at.' })
  accessTokenExpiresAt!: string;
}
