import { ApiProperty } from '@nestjs/swagger';

/** GET /auth/me and every session-issuing response's user shape — never the password hash, never
 * a token (tokens live only in httpOnly cookies, not the JSON body — security.md/CLAUDE.md §7.4). */
export class CurrentUserResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  tenantId!: string;

  @ApiProperty({ type: String, description: 'The tenant slug required to log back in — see LoginDto.tenantSlug.' })
  tenantSlug!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  fullName!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: [String] })
  permissions!: string[];
}

export class AuthSessionResponseDto {
  @ApiProperty({ type: CurrentUserResponseDto })
  user!: CurrentUserResponseDto;

  @ApiProperty({ type: String, description: 'ISO timestamp the current access token expires at.' })
  accessTokenExpiresAt!: string;
}
