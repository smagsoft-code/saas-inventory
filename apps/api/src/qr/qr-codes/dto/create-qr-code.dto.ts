import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export const QR_TARGET_TYPES = ['product_variant', 'location'] as const;

/** Matches `qr_codes_target_type_check` (database.md#qr-codes) exactly — `targetId` is validated
 * against the caller's own tenant in the service layer (QrTargetsRepository), never trusted as-is;
 * no `tenantId`/`code`/`id`/`status` field is accepted here (mass-assignment protection — the
 * global ValidationPipe's `forbidNonWhitelisted` rejects any of those if a client sends them). */
export class CreateQrCodeDto {
  @ApiProperty({ enum: QR_TARGET_TYPES })
  @IsIn(QR_TARGET_TYPES)
  targetType!: (typeof QR_TARGET_TYPES)[number];

  @ApiProperty({ type: String })
  @IsUUID()
  targetId!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
