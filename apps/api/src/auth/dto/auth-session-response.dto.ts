import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** GET /auth/me and every session-issuing response's user shape — never the password hash, never
 * a token (tokens live only in httpOnly cookies, not the JSON body — security.md/CLAUDE.md §7.4). */
export class CurrentUserResponseDto {
  @ApiProperty({ type: String, description: 'The tenant-scoped users.id.' })
  id!: string;

  @ApiProperty({ type: String, description: 'The global identities.id this user belongs to (016-C).' })
  identityId!: string;

  @ApiProperty({ type: String })
  tenantId!: string;

  @ApiProperty({ type: String, description: 'The active tenant slug — display only; login no longer takes it.' })
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

/** One selectable company in a multi-membership login response. Deliberately minimal — no slug,
 * no counts, nothing the caller does not need to render a picker (§13). */
export class AvailableTenantDto {
  @ApiProperty({ type: String, format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ type: String })
  name!: string;
}

/**
 * `POST /auth/login` response (016-C). Two shapes, discriminated by `status`:
 *  - `authenticated` — one active membership: `user` + `accessTokenExpiresAt` are present, session
 *    cookies are set.
 *  - `tenant_selection_required` — several active memberships: `availableTenants` +
 *    `selectionTokenExpiresAt` are present, the `tenant_selection` cookie is set (and
 *    `selectionToken` is echoed in the body for non-browser callers). NO session cookie, NO
 *    business access yet.
 */
export class LoginResponseDto {
  @ApiProperty({ enum: ['authenticated', 'tenant_selection_required'] })
  status!: 'authenticated' | 'tenant_selection_required';

  @ApiPropertyOptional({ type: CurrentUserResponseDto })
  user?: CurrentUserResponseDto;

  @ApiPropertyOptional({ type: String })
  accessTokenExpiresAt?: string;

  @ApiPropertyOptional({ type: [AvailableTenantDto] })
  availableTenants?: AvailableTenantDto[];

  @ApiPropertyOptional({ type: String })
  selectionTokenExpiresAt?: string;

  @ApiPropertyOptional({ type: String, description: 'Fallback for non-browser callers; browsers use the httpOnly cookie.' })
  selectionToken?: string;
}
