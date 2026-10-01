import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** ADR-0036 §6 — never the token, never a password. `status` is exactly the
 * `tenant_admin_invitations.status` value, EXCEPT this DTO derives `'expired'` at read time if
 * `expiresAt` has passed and the stored status is still `pending`/`sent` (same "derive rather than
 * rely on a cron to have already flipped it" posture the service applies elsewhere). */
export class InvitationStatusResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['pending', 'sent', 'accepted', 'expired', 'revoked'] })
  status!: string;

  @ApiPropertyOptional({ type: String })
  sentAt?: string;

  @ApiProperty({ type: String })
  expiresAt!: string;

  @ApiPropertyOptional({ type: String })
  acceptedAt?: string;

  @ApiPropertyOptional({ type: String })
  revokedAt?: string;
}
