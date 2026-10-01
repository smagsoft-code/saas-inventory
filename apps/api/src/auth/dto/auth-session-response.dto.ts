import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** ADR-0036 extension — present on `GET /auth/me` only when the caller is a Platform Admin
 * browsing this tenant under an active support session (never for a real tenant user). This is
 * what lets the tenant frontend render the same "MODO SOPORTE" banner `PlatformShell` already
 * shows, without a second request. */
export class TenantSupportSessionDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['read', 'write'] })
  mode!: 'read' | 'write';

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: String })
  expiresAt!: string;
}

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

  @ApiProperty({
    type: String,
    example: 'America/Bogota',
    description:
      "The active tenant's IANA timezone (tenant_settings.timezone, 'UTC' default). Unlike " +
      'GET /administration/tenant-settings, this is never permission-gated — F18-01, closes ' +
      'GAP-TZ-VISIBILITY so every authenticated tenant member can resolve calendar periods ' +
      "('today', 'this month') without administration.settings.view.",
  })
  timezone!: string;

  @ApiPropertyOptional({ type: TenantSupportSessionDto })
  supportSession?: TenantSupportSessionDto;
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
