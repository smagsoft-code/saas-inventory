import { ApiProperty } from '@nestjs/swagger';

/** `GET /auth/invitations/:token` (public) — just enough for the accept-invitation page to show
 * "you're activating your account for <company>" before asking for a password. Never the token
 * itself back, never anything about other tenants/users, never a hint distinguishing "not found"
 * from "expired" from "revoked" beyond what `valid`/`reason` already say (no email enumeration). */
export class InvitationInfoResponseDto {
  @ApiProperty({ type: Boolean })
  valid!: boolean;

  @ApiProperty({ type: String, required: false, enum: ['not_found', 'expired', 'revoked', 'accepted'] })
  reason?: string;

  @ApiProperty({ type: String, required: false })
  tenantName?: string;

  @ApiProperty({ type: String, required: false })
  email?: string;
}
