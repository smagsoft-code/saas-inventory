import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Management-view shape (`GET/POST/PATCH /qr-codes*`, catalog.qr.manage) — includes `code` (the
 * opaque token embedded in the physical QR image, needed here so an admin can retrieve/reprint it)
 * and every lifecycle field. Deliberately not reused by the public resolver's response (`GET
 * /q/:code`) or the authenticated resolve-identity response (`GET /qr-codes/resolve/:code`) — both
 * of those are separate, narrower DTOs (qr-public-response.dto.ts /
 * qr-resolve-identity-response.dto.ts) so a future field added here for admin purposes can never
 * silently leak through either of those by accident. */
export class QrCodeResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ enum: ['product_variant', 'location'] })
  targetType!: string;

  @ApiProperty({ type: String })
  targetId!: string;

  @ApiProperty({ enum: ['active', 'revoked'] })
  status!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  expiresAt?: string | undefined;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}
