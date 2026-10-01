import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SupportSessionResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  tenantId!: string;

  @ApiPropertyOptional({ type: String, description: 'Only present when resolvable without an extra lookup.' })
  tenantName?: string;

  @ApiProperty({ enum: ['read', 'write'] })
  mode!: string;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ enum: ['active', 'ended', 'expired'] })
  status!: string;

  @ApiProperty({ type: String })
  startedAt!: string;

  @ApiProperty({ type: String })
  expiresAt!: string;

  @ApiPropertyOptional({ type: String })
  endedAt?: string;
}
