import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlatformTenantResponseDto } from '../../dto/platform-tenant-response.dto';

export class ProvisionedAdminDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  fullName!: string;
}

/** Response of `POST /platform/tenants`. `invitationUrl`/`invitationExpiresAt` are present ONLY
 * when a new invitation was actually issued (ADR-0036 §4: an email that already resolves to an
 * `active` identity needs none — that admin can log in immediately with their existing global
 * password) — `identityReused: true` tells the SuperAdmin exactly that, so the UI can explain why
 * no link is shown instead of looking broken. Never contains a password, hash, or raw
 * `tokenHash` — `invitationUrl` embeds the RAW token, shown here exactly once (same "returned
 * once, never stored" convention as a refresh token), per ADR-0036 §5/§18 ("no exponer
 * credenciales" — the raw token is not a credential itself, but is treated with the same
 * one-time-visibility discipline). */
export class PlatformTenantOnboardingResponseDto {
  @ApiProperty({ type: PlatformTenantResponseDto })
  tenant!: PlatformTenantResponseDto;

  @ApiProperty({ type: ProvisionedAdminDto })
  admin!: ProvisionedAdminDto;

  @ApiProperty({ type: Boolean, description: 'True when adminEmail already had an active global identity — no invitation was needed or created.' })
  identityReused!: boolean;

  @ApiPropertyOptional({ type: String, description: 'Shown exactly once. Never persisted in raw form (only its hash is stored).' })
  invitationUrl?: string;

  @ApiPropertyOptional({ type: String })
  invitationExpiresAt?: string;
}
