import { ApiProperty } from '@nestjs/swagger';

/** GET /auth/me and every session-issuing response's user shape — never the password hash, never
 * a token (tokens live only in httpOnly cookies, not the JSON body — security.md/CLAUDE.md §7.4). */
export class CurrentUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ description: 'The tenant slug required to log back in — see LoginDto.tenantSlug.' })
  tenantSlug!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: [String] })
  permissions!: string[];
}

export class AuthSessionResponseDto {
  @ApiProperty({ type: CurrentUserResponseDto })
  user!: CurrentUserResponseDto;

  @ApiProperty({ description: 'ISO timestamp the current access token expires at.' })
  accessTokenExpiresAt!: string;
}
